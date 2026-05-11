'use strict';

/**
 * buildGridFirstCandidatePack: 라벨·값 셀 정의 줄 + 한 행 프리뷰 스냅샷.
 */

const path = require('path');
const { buildGridFirstCandidatePack } = require(path.join(__dirname, '..', 'services', 'field_classifier'));

function main() {
    const blocks = [
        {
            section_path: 'section1.xml',
            table_index: 0,
            grid_matrix: [
                ['id_a', 'id_b'],
            ],
        },
    ];
    const cellCandidates = [
        {
            target_cell_id: 'id_a',
            block_id: 'b0',
            section_path: 'section1.xml',
            table_index: 0,
            abs_x: 0,
            abs_y: 0,
            label: '업체명',
            fillable: false,
        },
        {
            target_cell_id: 'id_b',
            block_id: 'b0',
            section_path: 'section1.xml',
            table_index: 0,
            abs_x: 1,
            abs_y: 0,
            label: '',
            fillable: true,
        },
    ];
    const { definitionsText, gridText, tokenToId } = buildGridFirstCandidatePack(cellCandidates, blocks);
    if (!definitionsText.includes("cell_1 = '업체명'")) {
        console.error('FAIL: definitions missing label line\n', definitionsText);
        process.exit(1);
    }
    if (!definitionsText.includes("cell_2 = ''")) {
        console.error('FAIL: definitions missing empty value line\n', definitionsText);
        process.exit(1);
    }
    if (!gridText.includes('cell_1') || !gridText.includes('cell_2')) {
        console.error('FAIL: grid preview missing tokens\n', gridText);
        process.exit(1);
    }
    if (tokenToId.cell_1 !== 'id_a' || tokenToId.cell_2 !== 'id_b') {
        console.error('FAIL: tokenToId', tokenToId);
        process.exit(1);
    }

    const blocks2 = [
        {
            section_path: 's.xml',
            table_index: 0,
            grid_matrix: [
                ['a', 'b', 'c', 'd', 'e'],
                ['t', 't', 't', 't', 't'],
            ],
        },
    ];
    const pack2 = buildGridFirstCandidatePack(
        [
            {
                target_cell_id: 't',
                block_id: 'b',
                section_path: 's.xml',
                table_index: 0,
                abs_x: 0,
                abs_y: 1,
                row_span: 1,
                col_span: 5,
                label: '제목한줄',
                fillable: false,
            },
        ],
        blocks2,
    );
    if (!pack2.definitionsText.includes('((1), (0,1,2,3,4))')) {
        console.error('FAIL: merged row should list all cols in definition\n', pack2.definitionsText);
        process.exit(1);
    }
    const row1 = pack2.gridText.split('\n').find((ln) => ln.includes('cell_1') && ln.split('|').length >= 6);
    if (!row1 || (row1.match(/cell_1/g) || []).length < 5) {
        console.error('FAIL: grid preview should repeat cell_1 across 5 cols\n', pack2.gridText);
        process.exit(1);
    }

    console.log('OK: test_grid_first_pack');
}

main();
