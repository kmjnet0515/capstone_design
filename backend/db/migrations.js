'use strict';

/**
 * 신청서 작성 에이전트용 신규 테이블 3종.
 * 서버 부팅 시 idempotent 하게 CREATE TABLE IF NOT EXISTS 실행.
 */

const SQL_APPLICATION_SESSIONS = `
CREATE TABLE IF NOT EXISTS application_sessions (
    id INT NOT NULL AUTO_INCREMENT,
    user_id VARCHAR(64) NULL,
    program_id VARCHAR(64) NOT NULL,
    program_title VARCHAR(512) NULL,
    program_url VARCHAR(1024) NULL,
    source_file_url VARCHAR(1024) NULL,
    chosen_attachment_url VARCHAR(1024) NULL,
    chosen_attachment_name VARCHAR(512) NULL,
    raw_format VARCHAR(16) NULL,
    raw_s3_key VARCHAR(512) NULL,
    filled_s3_key VARCHAR(512) NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'created',
    error_message TEXT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_app_sessions_program (program_id),
    KEY idx_app_sessions_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;

const SQL_APPLICATION_FIELDS = `
CREATE TABLE IF NOT EXISTS application_fields (
    id INT NOT NULL AUTO_INCREMENT,
    session_id INT NOT NULL,
    kind VARCHAR(32) NOT NULL DEFAULT 'table_label',
    location_json JSON NOT NULL,
    prompt_label VARCHAR(255) NOT NULL,
    placeholder_text VARCHAR(255) NULL,
    value TEXT NULL,
    is_filled TINYINT(1) NOT NULL DEFAULT 0,
    order_index INT NOT NULL DEFAULT 0,
    filled_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_app_fields_session (session_id),
    CONSTRAINT fk_app_fields_session FOREIGN KEY (session_id)
        REFERENCES application_sessions (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;

const SQL_APPLICATION_MESSAGES = `
CREATE TABLE IF NOT EXISTS application_messages (
    id INT NOT NULL AUTO_INCREMENT,
    session_id INT NOT NULL,
    role VARCHAR(16) NOT NULL,
    content TEXT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_app_msgs_session (session_id),
    CONSTRAINT fk_app_msgs_session FOREIGN KEY (session_id)
        REFERENCES application_sessions (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;

/**
 * 같은 .hwp / .hwpx 파일에 대한 LLM 분류 결과를 캐싱.
 * - 키: 파일 내용 SHA-256 (file_hash)
 * - TTL: expires_at 까지 (생성 시 +7일 권장)
 * - 캐시 hit 시 grids/fields JSON 만 다시 읽으므로 LLM 재호출 0회
 */
const SQL_APPLICATION_DOCUMENT_CACHE = `
CREATE TABLE IF NOT EXISTS application_document_cache (
    id INT NOT NULL AUTO_INCREMENT,
    file_hash CHAR(64) NOT NULL,
    file_format VARCHAR(16) NOT NULL,
    file_size BIGINT NOT NULL,
    document_kind VARCHAR(32) NULL,
    confidence FLOAT NULL,
    reason TEXT NULL,
    classifier_model VARCHAR(64) NULL,
    grids_json LONGTEXT NULL,
    fields_json LONGTEXT NOT NULL,
    hit_count INT NOT NULL DEFAULT 0,
    last_hit_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_app_doc_cache_hash (file_hash),
    KEY idx_app_doc_cache_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;

async function _columnExists(conn, table, column) {
    const [rows] = await conn.query(
        `SELECT COUNT(*) AS c
           FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE()
            AND TABLE_NAME = ?
            AND COLUMN_NAME = ?`,
        [table, column]
    );
    return rows[0]?.c > 0;
}

async function _addColumnIfMissing(conn, table, column, ddl) {
    if (await _columnExists(conn, table, column)) return false;
    await conn.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
    return true;
}

/**
 * 진행률/큐/해시 컬럼 등 이후에 추가된 사항을 idempotent 하게 반영.
 */
async function _migrateApplicationSessionsExtras(conn) {
    const added = [];
    const tries = [
        ['progress_stage',     "VARCHAR(32) NULL"],
        ['progress_percent',   'TINYINT NULL'],
        ['progress_started_at','DATETIME NULL'],
        ['queue_position',     'INT NULL'],
        ['file_hash',          'CHAR(64) NULL'],
        ['filled_expires_at',  'DATETIME NULL'],
    ];
    for (const [col, ddl] of tries) {
        if (await _addColumnIfMissing(conn, 'application_sessions', col, ddl)) added.push(col);
    }
    return added;
}

/**
 * application_fields 추가 컬럼.
 * - is_skipped: 사용자가 «건너뛰기»한 항목 표시 (자동 채움/finalize 카운트에서 제외)
 * - skipped_at: 건너뛴 시각
 */
async function _migrateApplicationFieldsExtras(conn) {
    const added = [];
    const tries = [
        ['is_skipped', 'TINYINT(1) NOT NULL DEFAULT 0'],
        ['skipped_at', 'DATETIME NULL'],
    ];
    for (const [col, ddl] of tries) {
        if (await _addColumnIfMissing(conn, 'application_fields', col, ddl)) added.push(col);
    }
    return added;
}

async function runApplicationMigrations(pool) {
    const conn = await pool.getConnection();
    try {
        await conn.query(SQL_APPLICATION_SESSIONS);
        await conn.query(SQL_APPLICATION_FIELDS);
        await conn.query(SQL_APPLICATION_MESSAGES);
        await conn.query(SQL_APPLICATION_DOCUMENT_CACHE);
        const addedSession = await _migrateApplicationSessionsExtras(conn);
        const addedFields = await _migrateApplicationFieldsExtras(conn);
        return {
            ok: true,
            tables: [
                'application_sessions',
                'application_fields',
                'application_messages',
                'application_document_cache',
            ],
            added_columns: { sessions: addedSession, fields: addedFields },
        };
    } finally {
        conn.release();
    }
}

module.exports = { runApplicationMigrations };
