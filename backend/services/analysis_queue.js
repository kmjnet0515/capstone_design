'use strict';

/**
 * 신청서 분석 작업 직렬 처리 큐.
 *  - 동시 1건만 실행. 나머지는 FIFO 대기.
 *  - 작업 등록 시 ticket 반환 → 대기자 본인의 위치를 알 수 있음.
 *
 *   const ticket = analysisQueue.enqueue({ key: `session:${id}`, run: async (onProgress) => { ... } });
 *   ticket.position           // enqueue 직후 큐 내 위치 (0 = 즉시 실행)
 *   ticket.onPositionChange   // setter; 대기 중 위치가 바뀔 때마다 호출
 *
 *  진행 단계는 run() 함수 안에서 onProgress(stage, percent) 로 보고.
 */

class AnalysisQueue {
    constructor() {
        /** @type {Array<{key:string, run:Function, ticket:object}>} */
        this._waiting = [];
        this._running = null;
        this._lastSeen = new Map(); // key → 최근 작업 종료 시각
    }

    enqueue({ key, run, onPositionChange }) {
        // 같은 세션 키가 이미 running/waiting 이면 중복 등록하지 않음
        if (this._running && this._running.key === key) {
            return this._running.ticket;
        }
        const existing = this._waiting.find((w) => w.key === key);
        if (existing) {
            return existing.ticket;
        }

        const ticket = {
            key,
            position: this._running ? this._waiting.length + 1 : 0,
            status: 'queued',
            startedAt: null,
            finishedAt: null,
            onPositionChange: onPositionChange || (() => {}),
        };
        this._waiting.push({ key, run, ticket });
        this._notifyPositions();
        // 비동기로 즉시 시도
        setImmediate(() => this._tryRun());
        return ticket;
    }

    queueLength() {
        return this._waiting.length + (this._running ? 1 : 0);
    }

    isRunning() {
        return !!this._running;
    }

    snapshot() {
        return {
            running: this._running ? { key: this._running.key, startedAt: this._running.ticket.startedAt } : null,
            waiting: this._waiting.map((w, i) => ({ key: w.key, position: i + 1 })),
        };
    }

    _notifyPositions() {
        // running 작업은 position=0 이고, 나머지는 1..N
        this._waiting.forEach((w, i) => {
            const newPos = (this._running ? 1 : 0) + i;
            if (w.ticket.position !== newPos) {
                w.ticket.position = newPos;
                try { w.ticket.onPositionChange(newPos); } catch (_) { /* swallow */ }
            }
        });
    }

    async _tryRun() {
        if (this._running) return;
        const next = this._waiting.shift();
        if (!next) return;

        this._running = next;
        next.ticket.status = 'running';
        next.ticket.startedAt = Date.now();
        next.ticket.position = 0;
        try { next.ticket.onPositionChange(0); } catch (_) {}
        this._notifyPositions();

        try {
            await next.run(/* onProgress */ (stage, percent, extra) => {
                // 실행 중에는 컨트롤러가 직접 DB 업데이트하므로, 여기선 그냥 noop
                // (필요하면 ticket.lastStage = stage 같은 식으로 보관 가능)
            });
        } catch (e) {
            console.error(`[analysis_queue] 작업 ${next.key} 실패:`, e?.message || e);
        } finally {
            next.ticket.status = 'done';
            next.ticket.finishedAt = Date.now();
            this._lastSeen.set(next.key, Date.now());
            this._running = null;
            // 다음 작업으로
            setImmediate(() => {
                this._notifyPositions();
                this._tryRun();
            });
        }
    }
}

const singleton = new AnalysisQueue();

module.exports = {
    analysisQueue: singleton,
    AnalysisQueue,
};
