import { Component, Input, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HotTableModule, HotTableRegisterer } from '@handsontable/angular';
import { HyperFormula } from 'hyperformula';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';
import { FormsModule } from '@angular/forms';
import * as i0 from "@angular/core";
import * as i1 from "@angular/common";
import * as i2 from "@handsontable/angular";
import * as i3 from "@angular/forms";
export class ExcelifyComponent {
    excelData = [];
    griddata;
    workbook;
    sheetNames = [];
    selectedSheet = '';
    // HyperFormula engine instance (REQUIRED for formulas)
    hf = HyperFormula.buildEmpty({ licenseKey: 'gpl-v3' });
    formulas = { engine: this.hf };
    // @ts-ignore
    // Show insert/delete row/col etc. in context menu
    contextMenu = [
        'row_above',
        'row_below',
        'col_left',
        'col_right',
        'remove_row',
        'remove_col',
        '---------',
        'undo',
        'redo',
        // 'copy',  if you want to enable a copy cut 
        // 'cut',
        'alignment',
    ];
    // Handsontable license (dev/eval)
    licenseKey = 'non-commercial-and-evaluation';
    data;
    columns;
    sheetName;
    hideUpload = false;
    // Exclude columns by field or header text (case-insensitive)
    excludeColumns = [];
    // Constrained container size (customizable by parent)
    containerHeight = '70vh';
    containerWidth = '100%';
    // Number of top rows to treat as headers (not sortable)
    headerRows = 1;
    hotComponent;
    hot;
    hotRegisterer = new HotTableRegisterer();
    hotId = 'excelifyHot';
    selectedRow = 0;
    selectedCol = 0;
    nameBox = 'A1';
    formulaText = '';
    selectionStats = {
        sum: 0,
        average: null,
        numericCount: 0,
        count: 0,
        hasNonNumeric: false,
    };
    // Find panel state
    showFind = false;
    findQuery = '';
    findCaseSensitive = false;
    findResults = [];
    currentFindIndex = 0;
    findInput;
    lastSelection = null;
    replaceText = '';
    ngAfterViewInit() {
        this.hot = this.hotRegisterer.getInstance(this.hotId);
        if (!this.hot) {
            this.hot = this.hotComponent?.hotInstance;
        }
        if (this.hot) {
            this.hot.addHook('afterSelection', (r, c, r2, c2) => {
                this.handleSelectionChange(r, c, r2, c2);
            });
            this.hot.addHook('afterSelectionEnd', (r, c, r2, c2) => {
                this.handleSelectionChange(r, c, r2, c2);
            });
            this.hot.addHook('afterOnCellMouseDown', () => this.syncSelectionFromLastRange());
            this.hot.addHook('afterOnCellMouseUp', () => this.syncSelectionFromLastRange());
            this.hot.addHook('afterChange', () => {
                this.updateSelection(this.selectedRow, this.selectedCol);
            });
            // Alt+= autosum shortcut, Ctrl/Cmd+F open Find, Esc close Find
            this.hot.addHook('beforeKeyDown', (e) => {
                if (!e)
                    return;
                const key = e.key;
                const code = e.code;
                // Block copy/cut shortcuts inside the grid
                const isCtrlLike = e.ctrlKey || e.metaKey;
                const k = (key || '').toLowerCase();
                if (isCtrlLike && (k === 'c' || code === 'KeyC' || key === 'Insert')) {
                    e.preventDefault();
                    e.stopPropagation();
                    return;
                }
                if (isCtrlLike && (k === 'x' || code === 'KeyX')) {
                    e.preventDefault();
                    e.stopPropagation();
                    return;
                }
                if (e.altKey && (key === '=' || code === 'Equal')) {
                    e.preventDefault();
                    this.addSumOverSelection();
                    return;
                }
                if ((e.ctrlKey || e.metaKey) && (key?.toLowerCase() === 'f')) {
                    e.preventDefault();
                    this.openFindPanel();
                    return;
                }
                if (key === 'Escape' && this.showFind) {
                    e.preventDefault();
                    this.closeFindPanel();
                }
            });
            // Block programmatic copy/cut from Handsontable clipboard pipeline
            this.hot.addHook('beforeCopy', () => false);
            this.hot.addHook('beforeCut', () => false);
            // Sort only data rows, keep the first `headerRows` at the top
            this.hot.addHook('beforeColumnSort', (_currentCfg, destinationCfg) => {
                const cfg = Array.isArray(destinationCfg) ? destinationCfg[0] : destinationCfg;
                if (!cfg || cfg.column == null)
                    return; // allow default if unknown
                const colIndex = typeof cfg.column === 'number' ? cfg.column : (cfg.column?.visualIndex ?? cfg.column);
                const order = (cfg.sortOrder === 'desc') ? 'desc' : 'asc';
                try {
                    this.sortDataPreservingHeader(colIndex, order);
                }
                catch (e) {
                    console.warn('Custom sort failed, falling back to default', e);
                    return; // default will proceed
                }
                return false; // cancel default sorting since we applied our own
            });
        }
    }
    // Sorts rows below `headerRows` by the given column, keeping header rows unchanged
    sortDataPreservingHeader(colIndex, order) {
        const data = this.excelData || [];
        const headerCount = Math.max(0, Math.min(this.headerRows, data.length));
        if (data.length <= headerCount)
            return;
        const head = data.slice(0, headerCount);
        const body = data.slice(headerCount);
        const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
        const cmp = (a, b) => {
            const va = a?.[colIndex];
            const vb = b?.[colIndex];
            if (va == null && vb == null)
                return 0;
            if (va == null)
                return 1; // nulls last
            if (vb == null)
                return -1;
            const na = typeof va === 'number' ? va : Number(va);
            const nb = typeof vb === 'number' ? vb : Number(vb);
            let res;
            if (!Number.isNaN(na) && !Number.isNaN(nb))
                res = na - nb;
            else
                res = collator.compare(String(va), String(vb));
            return order === 'asc' ? res : -res;
        };
        body.sort(cmp);
        this.excelData = [...head, ...body];
        // Ensure Handsontable re-renders with updated data
        setTimeout(() => this.hot?.render());
    }
    colToLetter(col) {
        let s = '';
        let n = col + 1;
        while (n > 0) {
            const mod = (n - 1) % 26;
            s = String.fromCharCode(65 + mod) + s;
            n = Math.floor((n - mod) / 26);
        }
        return s;
    }
    handleSelectionChange(r1, c1, r2, c2) {
        const endRow = r2 ?? r1;
        const endCol = c2 ?? c1;
        this.lastSelection = {
            r1: Math.min(r1, endRow),
            c1: Math.min(c1, endCol),
            r2: Math.max(r1, endRow),
            c2: Math.max(c1, endCol),
        };
        this.updateSelection(r1, c1);
    }
    updateSelection(row, col) {
        this.selectedRow = row;
        this.selectedCol = col;
        this.nameBox = `${this.colToLetter(col)}${row + 1}`;
        const src = this.hot?.getSourceDataAtCell(row, col);
        this.formulaText = src == null ? '' : String(src);
        this.recalculateSelectionStats();
    }
    syncSelectionFromLastRange() {
        if (!this.hot)
            return;
        // @ts-ignore - depending on HOT version this may not be typed
        const range = this.hot.getSelectedRangeLast?.();
        if (!range)
            return;
        this.handleSelectionChange(range.from.row, range.from.col, range.to.row, range.to.col);
    }
    recalculateSelectionStats() {
        if (!this.hot) {
            this.selectionStats = { sum: 0, average: null, numericCount: 0, count: 0, hasNonNumeric: false };
            return;
        }
        let sum = 0;
        let numericCount = 0;
        let populatedCount = 0;
        let hasNonNumeric = false;
        this.forEachCellInSelection((r, c) => {
            if (r == null || c == null)
                return;
            const val = this.hot.getDataAtCell(r, c);
            if (!this.isValueEmpty(val))
                populatedCount++;
            const numeric = this.coerceToNumber(val);
            if (numeric != null) {
                sum += numeric;
                numericCount++;
            }
            else if (!this.isValueEmpty(val)) {
                hasNonNumeric = true;
            }
        });
        this.selectionStats = {
            sum: hasNonNumeric ? 0 : (numericCount ? sum : 0),
            average: !hasNonNumeric && numericCount ? sum / numericCount : null,
            numericCount,
            count: populatedCount,
            hasNonNumeric,
        };
    }
    coerceToNumber(value) {
        if (value === '' || value === null || value === undefined)
            return null;
        if (typeof value === 'number' && Number.isFinite(value))
            return value;
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    isValueEmpty(value) {
        if (value === null || value === undefined)
            return true;
        if (typeof value === 'string')
            return value.trim() === '';
        return false;
    }
    applyFormulaBar() {
        if (!this.hot)
            return;
        this.hot.setDataAtCell(this.selectedRow, this.selectedCol, this.formulaText);
    }
    // ===== Excel-like toolbar actions =====
    forEachCellInSelection(cb) {
        if (!this.hot)
            return;
        // @ts-ignore - getSelectedRange may be typed loosely depending on version
        const ranges = this.hot.getSelectedRange?.() || [];
        if (ranges.length) {
            ranges.forEach((range) => {
                const r1 = Math.min(range.from.row, range.to.row);
                const r2 = Math.max(range.from.row, range.to.row);
                const c1 = Math.min(range.from.col, range.to.col);
                const c2 = Math.max(range.from.col, range.to.col);
                for (let r = r1; r <= r2; r++) {
                    for (let c = c1; c <= c2; c++) {
                        cb(r, c);
                    }
                }
            });
            return;
        }
        if (this.lastSelection) {
            for (let r = this.lastSelection.r1; r <= this.lastSelection.r2; r++) {
                for (let c = this.lastSelection.c1; c <= this.lastSelection.c2; c++) {
                    cb(r, c);
                }
            }
            return;
        }
        cb(this.selectedRow, this.selectedCol);
    }
    updateClassOnSelection(addClasses = [], removeClasses = []) {
        if (!this.hot)
            return;
        const addSet = new Set(addClasses.filter(Boolean));
        const removeSet = new Set(removeClasses.filter(Boolean));
        this.forEachCellInSelection((r, c) => {
            const meta = this.hot.getCellMeta(r, c);
            const existing = (meta.className || '').split(/\s+/).filter(Boolean);
            let set = new Set(existing);
            removeSet.forEach(cls => set.delete(cls));
            addSet.forEach(cls => set.add(cls));
            const next = Array.from(set).join(' ');
            this.hot.setCellMeta(r, c, 'className', next);
        });
        this.hot.render();
    }
    toggleBold() {
        if (!this.hot)
            return;
        // Simple toggle: if first cell has htBold then remove, else add
        const meta = this.hot.getCellMeta(this.selectedRow, this.selectedCol);
        const has = (meta.className || '').split(/\s+/).includes('htBold');
        if (has)
            this.updateClassOnSelection([], ['htBold']);
        else
            this.updateClassOnSelection(['htBold']);
    }
    align(where) {
        const map = { left: 'htLeft', center: 'htCenter', right: 'htRight' };
        this.updateClassOnSelection([map[where]], ['htLeft', 'htCenter', 'htRight']);
    }
    toggleWrap() {
        if (!this.hot)
            return;
        const meta = this.hot.getCellMeta(this.selectedRow, this.selectedCol);
        const has = (meta.className || '').split(/\s+/).includes('htWrap');
        if (has)
            this.updateClassOnSelection([], ['htWrap']);
        else
            this.updateClassOnSelection(['htWrap']);
    }
    // ===== Quick functions based on current selection =====
    getFirstSelectionRange() {
        // @ts-ignore
        const ranges = this.hot?.getSelectedRange?.();
        if (!ranges || !ranges.length)
            return null;
        const r = ranges[0];
        const r1 = Math.min(r.from.row, r.to.row);
        const r2 = Math.max(r.from.row, r.to.row);
        const c1 = Math.min(r.from.col, r.to.col);
        const c2 = Math.max(r.from.col, r.to.col);
        return { r1, r2, c1, c2 };
    }
    rangeToA1(r1, c1, r2, c2) {
        const start = `${this.colToLetter(c1)}${r1 + 1}`;
        const end = `${this.colToLetter(c2)}${r2 + 1}`;
        return r1 === r2 && c1 === c2 ? start : `${start}:${end}`;
    }
    addSumOverSelection() {
        const sel = this.getFirstSelectionRange();
        if (!sel)
            return;
        // If selection is a single cell (likely current cell), default to summing the column above it (skip row 0 header)
        if (sel.r1 === sel.r2 && sel.c1 === sel.c2) {
            const col = this.selectedCol;
            const startRow = 1; // assume first row is header in our AOA
            const endRow = Math.max(startRow, this.selectedRow - 1);
            if (endRow >= startRow) {
                const a1col = this.rangeToA1(startRow, col, endRow, col);
                this.formulaText = `=SUM(${a1col})`;
                this.applyFormulaBar();
                return;
            }
        }
        // If current cell is inside the selected range, exclude it to avoid circular reference
        const within = this.selectedRow >= sel.r1 && this.selectedRow <= sel.r2 && this.selectedCol >= sel.c1 && this.selectedCol <= sel.c2;
        const sumArgs = within
            ? this.buildSumArgsExcludingActive(sel.r1, sel.c1, sel.r2, sel.c2, this.selectedRow, this.selectedCol)
            : this.rangeToA1(sel.r1, sel.c1, sel.r2, sel.c2);
        this.formulaText = `=SUM(${sumArgs})`;
        this.applyFormulaBar();
    }
    addAvgOverSelection() {
        const sel = this.getFirstSelectionRange();
        if (!sel)
            return;
        if (sel.r1 === sel.r2 && sel.c1 === sel.c2) {
            const col = this.selectedCol;
            const startRow = 1;
            const endRow = Math.max(startRow, this.selectedRow - 1);
            if (endRow >= startRow) {
                const a1col = this.rangeToA1(startRow, col, endRow, col);
                this.formulaText = `=AVERAGE(${a1col})`;
                this.applyFormulaBar();
                return;
            }
        }
        const within = this.selectedRow >= sel.r1 && this.selectedRow <= sel.r2 && this.selectedCol >= sel.c1 && this.selectedCol <= sel.c2;
        const args = within
            ? this.buildSumArgsExcludingActive(sel.r1, sel.c1, sel.r2, sel.c2, this.selectedRow, this.selectedCol)
            : this.rangeToA1(sel.r1, sel.c1, sel.r2, sel.c2);
        this.formulaText = `=AVERAGE(${args})`;
        this.applyFormulaBar();
    }
    addCountOverSelection() {
        const sel = this.getFirstSelectionRange();
        if (!sel)
            return;
        if (sel.r1 === sel.r2 && sel.c1 === sel.c2) {
            const col = this.selectedCol;
            const startRow = 1;
            const endRow = Math.max(startRow, this.selectedRow - 1);
            if (endRow >= startRow) {
                const a1col = this.rangeToA1(startRow, col, endRow, col);
                this.formulaText = `=COUNT(${a1col})`;
                this.applyFormulaBar();
                return;
            }
        }
        const within = this.selectedRow >= sel.r1 && this.selectedRow <= sel.r2 && this.selectedCol >= sel.c1 && this.selectedCol <= sel.c2;
        const args = within
            ? this.buildSumArgsExcludingActive(sel.r1, sel.c1, sel.r2, sel.c2, this.selectedRow, this.selectedCol)
            : this.rangeToA1(sel.r1, sel.c1, sel.r2, sel.c2);
        this.formulaText = `=COUNT(${args})`;
        this.applyFormulaBar();
    }
    // Build comma-separated SUM arguments covering a rectangle but excluding the active cell
    buildSumArgsExcludingActive(r1, c1, r2, c2, ar, ac) {
        const parts = [];
        // Top block (rows above active row)
        if (ar - 1 >= r1) {
            parts.push(this.rangeToA1(r1, c1, ar - 1, c2));
        }
        // Bottom block (rows below active row)
        if (ar + 1 <= r2) {
            parts.push(this.rangeToA1(ar + 1, c1, r2, c2));
        }
        // Same row: left segment
        if (ac - 1 >= c1) {
            parts.push(this.rangeToA1(ar, c1, ar, ac - 1));
        }
        // Same row: right segment
        if (ac + 1 <= c2) {
            parts.push(this.rangeToA1(ar, ac + 1, ar, c2));
        }
        // Fallback if nothing was added (shouldn't happen unless selection is single cell)
        return parts.filter(Boolean).join(',');
    }
    // ===== Find panel logic using Handsontable Search plugin =====
    openFindPanel() {
        this.showFind = true;
        this.focusFindInput();
    }
    closeFindPanel() {
        this.showFind = false;
        this.clearFind();
    }
    runFind() {
        if (!this.hot)
            return;
        const shouldRefocus = this.isFindInputFocused();
        // Use search plugin
        // @ts-ignore
        const search = this.hot.getPlugin('search');
        const query = this.findQuery || '';
        const cmp = (q, value) => {
            if (!q)
                return false;
            const val = value == null ? '' : String(value);
            if (this.findCaseSensitive)
                return val.indexOf(q) !== -1;
            return val.toLowerCase().indexOf(q.toLowerCase()) !== -1;
        };
        const results = search.query(query, undefined, (qStr, value) => cmp(qStr, value)) || [];
        this.findResults = results.map((r) => ({ row: r.row, col: r.col }));
        this.currentFindIndex = 0;
        if (this.findResults.length)
            this.gotoFindIndex(0, shouldRefocus);
        else if (shouldRefocus)
            this.focusFindInput();
        this.hot.render();
    }
    clearFind() {
        this.findQuery = '';
        this.findResults = [];
        this.currentFindIndex = 0;
        if (this.hot) {
            // Clear highlights by running empty query
            // @ts-ignore
            const search = this.hot.getPlugin('search');
            search.query('');
            this.hot.render();
        }
    }
    gotoFindIndex(idx, refocus = false) {
        if (!this.hot || !this.findResults.length)
            return;
        const hadFindFocus = refocus || this.isFindInputFocused();
        const n = this.findResults.length;
        this.currentFindIndex = ((idx % n) + n) % n; // wrap
        const { row, col } = this.findResults[this.currentFindIndex];
        this.hot.selectCell(row, col, row, col, true, true);
        this.updateSelection(row, col);
        if (hadFindFocus)
            this.focusFindInput();
    }
    nextFind() { this.gotoFindIndex(this.currentFindIndex + 1); }
    prevFind() { this.gotoFindIndex(this.currentFindIndex - 1); }
    isFindInputFocused() {
        const active = typeof document !== 'undefined' ? document.activeElement : null;
        return !!(this.findInput?.nativeElement && active === this.findInput.nativeElement);
    }
    focusFindInput() {
        setTimeout(() => this.findInput?.nativeElement?.focus(), 0);
    }
    replaceCurrent() {
        if (!this.hot || !this.findQuery)
            return;
        if (!this.findResults.length) {
            this.runFind();
            if (!this.findResults.length)
                return;
        }
        const { row, col } = this.findResults[this.currentFindIndex];
        const currentValue = this.hot.getDataAtCell(row, col);
        const next = this.buildReplacement(String(currentValue ?? ''), false);
        if (next === null)
            return;
        this.hot.setDataAtCell(row, col, next);
        this.hot.render();
        this.runFind();
    }
    replaceAllMatches() {
        if (!this.hot || !this.findQuery)
            return;
        const rows = this.hot.countRows?.() ?? 0;
        const cols = this.hot.countCols?.() ?? 0;
        if (!rows || !cols)
            return;
        let didReplace = false;
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const value = this.hot.getDataAtCell(r, c);
                const next = this.buildReplacement(String(value ?? ''), true);
                if (next !== null) {
                    this.hot.setDataAtCell(r, c, next);
                    didReplace = true;
                }
            }
        }
        if (didReplace) {
            this.hot.render();
        }
        this.runFind();
    }
    buildReplacement(value, allOccurrences) {
        const query = this.findQuery;
        if (!query)
            return null;
        const flags = this.findCaseSensitive ? '' : 'i';
        const escaped = this.escapeRegExp(query);
        const re = new RegExp(escaped, allOccurrences ? `g${flags}` : flags);
        if (!re.test(value))
            return null;
        re.lastIndex = 0; // reset for reuse
        return value.replace(re, this.replaceText ?? '');
    }
    escapeRegExp(str) {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
    // Ensure cells are primitives acceptable by Handsontable/HyperFormula
    sanitizeCell(value) {
        if (value === null || value === undefined)
            return '';
        if (Array.isArray(value))
            return value.join(', ');
        const t = typeof value;
        if (t === 'string' || t === 'number' || t === 'boolean')
            return value;
        if (value instanceof Date)
            return value.toISOString();
        try {
            return JSON.stringify(value);
        }
        catch {
            return String(value);
        }
    }
    sanitizeAoa(aoa) {
        return (aoa || []).map(row => Array.isArray(row) ? row.map(c => this.sanitizeCell(c)) : [this.sanitizeCell(row)]);
    }
    // Remove leading entirely empty rows so the header is at the very top
    trimLeadingEmptyRows(aoa) {
        const isEmpty = (v) => v === '' || v === null || v === undefined;
        let start = 0;
        while (start < (aoa?.length || 0)) {
            const row = aoa[start] || [];
            if (row.some(cell => !isEmpty(cell)))
                break;
            start++;
        }
        return (aoa || []).slice(start);
    }
    ngOnChanges(changes) {
        if (changes['data'] || changes['columns'] || changes['sheetName']) {
            console.log('changes', changes);
            if (Array.isArray(this.data) && this.data.length > 0) {
                this.setSheetFromObjects(this.data, this.columns, this.sheetName || 'Sheet1');
            }
            else if (Array.isArray(this.data) && this.data.length === 0) {
                // If explicitly passed empty data, clear the table
                this.excelData = [];
                this.workbook = undefined;
                this.sheetNames = [];
                this.selectedSheet = '';
            }
        }
    }
    setSheetFromObjects(rows, cols, name = 'Sheet1') {
        const resolvedCols = cols && cols.length
            ? cols.map(c => ({ field: c.field, header: c.header || c.field }))
            : Object.keys(rows[0] || {}).map(k => ({ field: k, header: k }));
        const excludes = (this.excludeColumns || []).map(e => String(e).toLowerCase());
        const filteredCols = resolvedCols.filter(c => {
            const f = (c.field || '').toString().toLowerCase();
            const h = (c.header || '').toString().toLowerCase();
            return !(excludes.includes(f) || excludes.includes(h));
        });
        const finalCols = filteredCols.length > 0 ? filteredCols : resolvedCols;
        const headerRow = finalCols.map(c => c.header);
        const dataRows = rows.map(r => finalCols.map(c => this.sanitizeCell(r?.[c.field])));
        const aoa = [headerRow, ...dataRows];
        const clean = this.sanitizeAoa(aoa);
        this.excelData = (clean && clean.length) ? clean : [['']];
        this.workbook = undefined;
        this.sheetNames = [name];
        this.selectedSheet = name;
    }
    onFileChange(event) {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file)
            return;
        const reader = new FileReader();
        reader.onload = (e) => {
            const data = new Uint8Array(e.target.result);
            this.workbook = XLSX.read(data, { type: 'array' });
            this.sheetNames = this.workbook.SheetNames ?? [];
            this.selectedSheet = this.sheetNames[0] ?? '';
            if (!this.selectedSheet) {
                this.excelData = [];
                return;
            }
            this.loadSheet(this.selectedSheet);
        };
        reader.readAsArrayBuffer(file);
    }
    loadSheet(sheetName) {
        if (!this.workbook)
            return;
        const ws = this.workbook.Sheets[sheetName];
        const aoa = XLSX.utils.sheet_to_json(ws, { header: 1 });
        const clean = this.sanitizeAoa(aoa);
        const trimmed = this.trimLeadingEmptyRows(clean);
        this.excelData = (trimmed && trimmed.length) ? trimmed : [['']];
    }
    onSheetChange(event) {
        const sheet = event.target.value;
        this.selectedSheet = sheet;
        this.loadSheet(sheet);
    }
    downloadExcel() {
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.aoa_to_sheet(this.excelData);
        const name = this.selectedSheet || this.sheetName || 'Sheet1';
        XLSX.utils.book_append_sheet(wb, ws, name);
        const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
        const blob = new Blob([buf], { type: 'application/octet-stream' });
        saveAs(blob, 'updated_excel.xlsx');
    }
    static ɵfac = i0.ɵɵngDeclareFactory({ minVersion: "12.0.0", version: "18.2.12", ngImport: i0, type: ExcelifyComponent, deps: [], target: i0.ɵɵFactoryTarget.Component });
    static ɵcmp = i0.ɵɵngDeclareComponent({ minVersion: "14.0.0", version: "18.2.12", type: ExcelifyComponent, isStandalone: true, selector: "eq-excelify", inputs: { griddata: "griddata", data: "data", columns: "columns", sheetName: "sheetName", hideUpload: "hideUpload", excludeColumns: "excludeColumns", containerHeight: "containerHeight", containerWidth: "containerWidth", headerRows: "headerRows" }, viewQueries: [{ propertyName: "hotComponent", first: true, predicate: ["hotRef"], descendants: true }, { propertyName: "findInput", first: true, predicate: ["findInput"], descendants: true }], usesOnChanges: true, ngImport: i0, template: "<div class=\"container\">\r\n  <div class=\"upload-section\" *ngIf=\"!hideUpload\">\r\n    <label for=\"file-upload\" class=\"upload-btn\">Upload Excel</label>\r\n    <input type=\"file\" id=\"file-upload\" accept=\".xlsx,.xls,.csv\" (change)=\"onFileChange($event)\" hidden />\r\n    <button class=\"download-btn\" (click)=\"downloadExcel()\" [disabled]=\"!excelData.length\">Download Updated Excel</button>\r\n  </div>\r\n\r\n  <div *ngIf=\"sheetNames.length > 1\" class=\"sheet-selector\">\r\n    <label for=\"sheetSelect\">Select Sheet:</label>\r\n    <select id=\"sheetSelect\" (change)=\"onSheetChange($event)\" [value]=\"selectedSheet\">\r\n      <option *ngFor=\"let sheet of sheetNames\" [value]=\"sheet\">{{ sheet }}</option>\r\n    </select>\r\n  </div>\r\n\r\n  <div *ngIf=\"excelData.length > 0\" class=\"excel-wrapper\" [ngStyle]=\"{ width: containerWidth }\">\r\n    <div class=\"excel-toolbar\">\r\n      <button type=\"button\" class=\"tlb-btn\" title=\"Bold\" (click)=\"toggleBold()\"><strong>B</strong></button>\r\n      <div class=\"tlb-sep\"></div>\r\n      <button type=\"button\" class=\"tlb-btn\" title=\"Align left\" (click)=\"align('left')\">L</button>\r\n      <button type=\"button\" class=\"tlb-btn\" title=\"Align center\" (click)=\"align('center')\">C</button>\r\n      <button type=\"button\" class=\"tlb-btn\" title=\"Align right\" (click)=\"align('right')\">R</button>\r\n      <div class=\"tlb-sep\"></div>\r\n      <button type=\"button\" class=\"tlb-btn\" title=\"Wrap text\" (click)=\"toggleWrap()\">Wrap</button>\r\n      <div class=\"tlb-sep\"></div>\r\n      <button type=\"button\" class=\"tlb-btn\" title=\"AutoSum (Alt+=)\" (click)=\"addSumOverSelection()\">Sum</button>\r\n      <button type=\"button\" class=\"tlb-btn\" title=\"Average\" (click)=\"addAvgOverSelection()\">Avg</button>\r\n      <button type=\"button\" class=\"tlb-btn\" title=\"Count\" (click)=\"addCountOverSelection()\">Cnt</button>\r\n      <div class=\"tlb-grow\"></div>\r\n      <input class=\"name-box\" [value]=\"nameBox\" readonly aria-label=\"Cell address\" />\n      <input class=\"formula-input\" [(ngModel)]=\"formulaText\" (keyup.enter)=\"applyFormulaBar()\" (blur)=\"applyFormulaBar()\" placeholder=\"fx\" aria-label=\"Formula bar\" />\n      <button type=\"button\" class=\"tlb-btn\" title=\"Find (Ctrl+F)\" (click)=\"openFindPanel()\">Find</button>\n      <div class=\"find-panel\" *ngIf=\"showFind\">\n        <input #findInput class=\"find-input\" [(ngModel)]=\"findQuery\" (input)=\"runFind()\" (keyup.enter)=\"nextFind()\" placeholder=\"Find...\" />\n        <input class=\"replace-input\" [(ngModel)]=\"replaceText\" placeholder=\"Replace with...\" />\n        <label class=\"find-opt\"><input type=\"checkbox\" [(ngModel)]=\"findCaseSensitive\" (change)=\"runFind()\" /> Case</label>\n        <span class=\"find-count\">{{ findResults.length ? (currentFindIndex + 1) + '/' + findResults.length : '0/0' }}</span>\n        <button type=\"button\" class=\"tlb-btn\" (click)=\"prevFind()\">Prev</button>\n        <button type=\"button\" class=\"tlb-btn\" (click)=\"nextFind()\">Next</button>\n        <button type=\"button\" class=\"tlb-btn\" (click)=\"replaceCurrent()\" [disabled]=\"!findQuery\">Replace</button>\n        <button type=\"button\" class=\"tlb-btn\" (click)=\"replaceAllMatches()\" [disabled]=\"!findQuery\">Replace All</button>\n        <button type=\"button\" class=\"tlb-btn\" (click)=\"closeFindPanel()\">Close</button>\n      </div>\n    </div>\n    <div class=\"table-container\" [ngStyle]=\"{ height: containerHeight }\">\n      <hot-table #hotRef [hotId]=\"hotId\" class=\"hot-full\"\n        [data]=\"excelData\" [rowHeaders]=\"true\" [colHeaders]=\"true\"\n        [dropdownMenu]=\"true\" [filters]=\"true\" [search]=\"true\"\n        [contextMenu]=\"contextMenu\" [formulas]=\"formulas\" [licenseKey]=\"licenseKey\"\r\n        [copyPaste]=\"false\"\r\n        [stretchH]=\"'all'\" [manualColumnResize]=\"true\" [manualRowResize]=\"true\"\r\n        [manualColumnMove]=\"true\" [manualRowMove]=\"true\" [columnSorting]=\"true\"\r\n        [fillHandle]=\"true\" [fixedRowsTop]=\"headerRows\" [fixedColumnsLeft]=\"0\"\r\n        [outsideClickDeselects]=\"false\" [currentRowClassName]=\"'currentRow'\"\r\n        [currentColClassName]=\"'currentCol'\">\n      </hot-table>\n    </div>\n    <div class=\"status-bar\" aria-live=\"polite\">\n      <ng-container *ngIf=\"!selectionStats.hasNonNumeric && selectionStats.numericCount > 0; else countOnly\">\n        <div class=\"status-item\">\n          <span class=\"status-label\">Average</span>\n          <span class=\"status-value\">{{ selectionStats.average !== null ? (selectionStats.average | number:'1.0-4') : '\u2014' }}</span>\n        </div>\n        <div class=\"status-item\">\n          <span class=\"status-label\">Count</span>\n          <span class=\"status-value\">{{ selectionStats.count }}</span>\n        </div>\n        <div class=\"status-item\">\n          <span class=\"status-label\">Sum</span>\n          <span class=\"status-value\">{{ selectionStats.numericCount ? (selectionStats.sum | number:'1.0-4') : '\u2014' }}</span>\n        </div>\n      </ng-container>\n      <ng-template #countOnly>\n        <div class=\"status-item\">\n          <span class=\"status-label\">Count</span>\n          <span class=\"status-value\">{{ selectionStats.count }}</span>\n        </div>\n      </ng-template>\n    </div>\n  </div>\n</div>\n", styles: [".container{padding:16px;font-family:Arial,sans-serif}.upload-section{display:flex;gap:12px;margin-bottom:12px}.upload-btn{background-color:#4caf50;color:#fff;padding:8px 14px;border-radius:6px;cursor:pointer}.download-btn{background-color:#2196f3;color:#fff;padding:8px 14px;border-radius:6px;cursor:pointer;border:none}.download-btn:disabled{background-color:#ccc;cursor:not-allowed}.sheet-selector{margin-bottom:12px}.table-container{border:1px solid #ddd;box-shadow:0 2px 6px #0000001a;height:70vh;overflow:auto}.excel-wrapper{max-width:100%;margin:0 auto}.excel-toolbar{display:flex;align-items:center;gap:6px;padding:6px 0 4px}.tlb-btn{padding:4px 8px;border:1px solid #d0d0d0;border-radius:4px;background:#f7f7f7;cursor:pointer}.tlb-btn:hover{background:#efefef}.tlb-sep{width:1px;height:20px;background:#ddd;margin:0 4px}.tlb-grow{flex:1 1 auto}.formula-bar{display:grid;grid-template-columns:90px 1fr;gap:8px;align-items:center;padding:8px 0}.name-box{border:1px solid #ccc;border-radius:4px;padding:6px 8px;background:#f7f7f7;font-weight:600;width:4%}.formula-input{border:1px solid #ccc;border-radius:4px;padding:6px 10px;width:13%}.hot-full{display:block;width:100%;height:100%}.status-bar{display:flex;justify-content:flex-end;align-items:center;gap:24px;padding:6px 12px;border:1px solid #dcdcdc;border-top:none;background:#f6f7fb;font-size:13px;color:#222;font-family:Segoe UI,Arial,sans-serif}.status-item{display:inline-flex;gap:6px;align-items:baseline}.status-label{font-size:12px;text-transform:uppercase;letter-spacing:.5px;color:#5f5f5f}.status-value{min-width:56px;text-align:right;font-weight:600}:host ::ng-deep .handsontable thead th{background:#f3f3f3;border-bottom:1px solid #d9d9d9}:host ::ng-deep .handsontable .ht_clone_top thead th{background:#f3f3f3}:host ::ng-deep .handsontable .currentRow td{background:#f9fbff!important}:host ::ng-deep .handsontable .currentCol{background:#f9fbff!important}:host ::ng-deep .handsontable .htBold{font-weight:700}:host ::ng-deep .handsontable .htSearchResult{background-color:#fff2a8!important}.find-panel{display:inline-flex;align-items:center;flex-wrap:wrap;gap:6px;padding:6px 8px;border:1px solid #ddd;border-radius:6px;background:#fff;box-shadow:0 2px 6px #00000014;margin:6px 0}.find-input{border:1px solid #ccc;border-radius:4px;padding:6px 8px;min-width:220px}.replace-input{border:1px solid #ccc;border-radius:4px;padding:6px 8px;min-width:180px}.find-opt{display:inline-flex;align-items:center;gap:4px;font-size:12px;color:#555}.find-count{font-size:12px;color:#666}:host ::ng-deep .handsontable .htCore tbody tr:nth-child(1) td{font-weight:600;font-weight:700;background-color:#b1c8c9}\n"], dependencies: [{ kind: "ngmodule", type: CommonModule }, { kind: "directive", type: i1.NgForOf, selector: "[ngFor][ngForOf]", inputs: ["ngForOf", "ngForTrackBy", "ngForTemplate"] }, { kind: "directive", type: i1.NgIf, selector: "[ngIf]", inputs: ["ngIf", "ngIfThen", "ngIfElse"] }, { kind: "directive", type: i1.NgStyle, selector: "[ngStyle]", inputs: ["ngStyle"] }, { kind: "pipe", type: i1.DecimalPipe, name: "number" }, { kind: "ngmodule", type: HotTableModule }, { kind: "component", type: i2.HotTableComponent, selector: "hot-table", inputs: ["settings", "hotId", "activeHeaderClassName", "allowEmpty", "allowHtml", "allowInsertColumn", "allowInsertRow", "allowInvalid", "allowRemoveColumn", "allowRemoveRow", "ariaTags", "autoColumnSize", "autoRowSize", "autoWrapCol", "autoWrapRow", "bindRowsWithHeaders", "cell", "cells", "checkedTemplate", "className", "colHeaders", "collapsibleColumns", "columnHeaderHeight", "columns", "columnSorting", "columnSummary", "colWidths", "commentedCellClassName", "comments", "contextMenu", "copyable", "copyPaste", "correctFormat", "currentColClassName", "currentHeaderClassName", "currentRowClassName", "customBorders", "data", "dataDotNotation", "dataSchema", "dateFormat", "datePickerConfig", "defaultDate", "tabNavigation", "themeName", "disableVisualSelection", "dragToScroll", "dropdownMenu", "editor", "enterBeginsEditing", "enterMoves", "fillHandle", "filter", "filteringCaseSensitive", "filters", "fixedColumnsLeft", "fixedColumnsStart", "fixedRowsBottom", "fixedRowsTop", "formulas", "fragmentSelection", "headerClassName", "height", "hiddenColumns", "hiddenRows", "invalidCellClassName", "imeFastEdit", "label", "language", "layoutDirection", "licenseKey", "locale", "manualColumnFreeze", "manualColumnMove", "manualColumnResize", "manualRowMove", "manualRowResize", "maxCols", "maxRows", "mergeCells", "minCols", "minRows", "minSpareCols", "minSpareRows", "multiColumnSorting", "navigableHeaders", "nestedHeaders", "nestedRows", "noWordWrapClassName", "numericFormat", "observeDOMVisibility", "outsideClickDeselects", "persistentState", "placeholder", "placeholderCellClassName", "preventOverflow", "preventWheel", "readOnly", "readOnlyCellClassName", "renderAllColumns", "renderAllRows", "renderer", "rowHeaders", "rowHeaderWidth", "rowHeights", "search", "selectionMode", "selectOptions", "skipColumnOnPaste", "skipRowOnPaste", "sortByRelevance", "source", "startCols", "startRows", "stretchH", "strict", "tableClassName", "tabMoves", "title", "trimDropdown", "trimRows", "trimWhitespace", "type", "uncheckedTemplate", "undo", "validator", "viewportColumnRenderingOffset", "viewportRowRenderingOffset", "visibleRows", "width", "wordWrap", "afterAddChild", "afterAutofill", "afterBeginEditing", "afterCellMetaReset", "afterChange", "afterChangesObserved", "afterColumnCollapse", "afterColumnExpand", "afterColumnFreeze", "afterColumnMove", "afterColumnResize", "afterColumnSequenceChange", "afterColumnSort", "afterColumnUnfreeze", "afterContextMenuDefaultOptions", "afterContextMenuHide", "afterContextMenuShow", "afterCopy", "afterCopyLimit", "afterCreateCol", "afterCreateRow", "afterCut", "afterDeselect", "afterDestroy", "afterDetachChild", "afterDocumentKeyDown", "afterDrawSelection", "afterDropdownMenuDefaultOptions", "afterDropdownMenuHide", "afterDropdownMenuShow", "afterFilter", "afterFormulasValuesUpdate", "afterGetCellMeta", "afterGetColHeader", "afterGetColumnHeaderRenderers", "afterGetRowHeader", "afterGetRowHeaderRenderers", "afterHideColumns", "afterHideRows", "afterInit", "afterLanguageChange", "afterListen", "afterLoadData", "afterMergeCells", "afterModifyTransformEnd", "afterModifyTransformFocus", "afterModifyTransformStart", "afterMomentumScroll", "afterNamedExpressionAdded", "afterNamedExpressionRemoved", "afterOnCellContextMenu", "afterOnCellCornerDblClick", "afterOnCellCornerMouseDown", "afterOnCellMouseDown", "afterOnCellMouseOut", "afterOnCellMouseOver", "afterOnCellMouseUp", "afterPaste", "afterPluginsInitialized", "afterRedo", "afterRedoStackChange", "afterRefreshDimensions", "afterRemoveCellMeta", "afterRemoveCol", "afterRemoveRow", "afterRender", "afterRenderer", "afterRowMove", "afterRowResize", "afterRowSequenceChange", "afterScrollHorizontally", "afterScrollVertically", "afterScroll", "afterSelectColumns", "afterSelection", "afterSelectionByProp", "afterSelectionEnd", "afterSelectionEndByProp", "afterSelectionFocusSet", "afterSelectRows", "afterSetCellMeta", "afterSetDataAtCell", "afterSetDataAtRowProp", "afterSetSourceDataAtCell", "afterSetTheme", "afterSheetAdded", "afterSheetRenamed", "afterSheetRemoved", "afterTrimRow", "afterUndo", "afterUndoStackChange", "afterUnhideColumns", "afterUnhideRows", "afterUnlisten", "afterUnmergeCells", "afterUntrimRow", "afterUpdateData", "afterUpdateSettings", "afterValidate", "afterViewportColumnCalculatorOverride", "afterViewportRowCalculatorOverride", "afterViewRender", "beforeAddChild", "beforeAutofill", "beforeBeginEditing", "beforeCellAlignment", "beforeChange", "beforeChangeRender", "beforeColumnCollapse", "beforeColumnExpand", "beforeColumnFreeze", "beforeColumnMove", "beforeColumnResize", "beforeColumnSort", "beforeColumnWrap", "beforeColumnUnfreeze", "beforeCompositionStart", "beforeContextMenuSetItems", "beforeContextMenuShow", "beforeCopy", "beforeCreateCol", "beforeCreateRow", "beforeCut", "beforeDetachChild", "beforeDrawBorders", "beforeDropdownMenuSetItems", "beforeDropdownMenuShow", "beforeFilter", "beforeGetCellMeta", "beforeHideColumns", "beforeHideRows", "beforeHighlightingColumnHeader", "beforeHighlightingRowHeader", "beforeInit", "beforeInitWalkontable", "beforeKeyDown", "beforeLanguageChange", "beforeLoadData", "beforeMergeCells", "beforeOnCellContextMenu", "beforeOnCellMouseDown", "beforeOnCellMouseOut", "beforeOnCellMouseOver", "beforeOnCellMouseUp", "beforePaste", "beforeRedo", "beforeRedoStackChange", "beforeRefreshDimensions", "beforeRemoveCellClassNames", "beforeRemoveCellMeta", "beforeRemoveCol", "beforeRemoveRow", "beforeRender", "beforeRenderer", "beforeRowMove", "beforeRowResize", "beforeRowWrap", "beforeSelectColumns", "beforeSelectionFocusSet", "beforeSelectionHighlightSet", "beforeSelectRows", "beforeSetCellMeta", "beforeSetRangeEnd", "beforeSetRangeStart", "beforeSetRangeStartOnly", "beforeStretchingColumnWidth", "beforeTouchScroll", "beforeTrimRow", "beforeUndo", "beforeUndoStackChange", "beforeUnhideColumns", "beforeUnhideRows", "beforeUnmergeCells", "beforeUntrimRow", "beforeUpdateData", "beforeValidate", "beforeValueRender", "beforeViewportScroll", "beforeViewportScrollHorizontally", "beforeViewportScrollVertically", "beforeViewRender", "construct", "init", "modifyAutoColumnSizeSeed", "modifyAutofillRange", "modifyColHeader", "modifyColumnHeaderHeight", "modifyColumnHeaderValue", "modifyColWidth", "modifyCopyableRange", "modifyFiltersMultiSelectValue", "modifyFocusedElement", "modifyData", "modifyFocusOnTabNavigation", "modifyGetCellCoords", "modifyGetCoordsElement", "modifyRowData", "modifyRowHeader", "modifyRowHeaderWidth", "modifyRowHeight", "modifyRowHeightByOverlayName", "modifySourceData", "modifyTransformEnd", "modifyTransformFocus", "modifyTransformStart", "persistentStateLoad", "persistentStateReset", "persistentStateSave"] }, { kind: "ngmodule", type: FormsModule }, { kind: "directive", type: i3.NgSelectOption, selector: "option", inputs: ["ngValue", "value"] }, { kind: "directive", type: i3.ɵNgSelectMultipleOption, selector: "option", inputs: ["ngValue", "value"] }, { kind: "directive", type: i3.DefaultValueAccessor, selector: "input:not([type=checkbox])[formControlName],textarea[formControlName],input:not([type=checkbox])[formControl],textarea[formControl],input:not([type=checkbox])[ngModel],textarea[ngModel],[ngDefaultControl]" }, { kind: "directive", type: i3.CheckboxControlValueAccessor, selector: "input[type=checkbox][formControlName],input[type=checkbox][formControl],input[type=checkbox][ngModel]" }, { kind: "directive", type: i3.NgControlStatus, selector: "[formControlName],[ngModel],[formControl]" }, { kind: "directive", type: i3.NgModel, selector: "[ngModel]:not([formControlName]):not([formControl])", inputs: ["name", "disabled", "ngModel", "ngModelOptions"], outputs: ["ngModelChange"], exportAs: ["ngModel"] }] });
}
i0.ɵɵngDeclareClassMetadata({ minVersion: "12.0.0", version: "18.2.12", ngImport: i0, type: ExcelifyComponent, decorators: [{
            type: Component,
            args: [{ selector: 'eq-excelify', standalone: true, imports: [CommonModule, HotTableModule, FormsModule], template: "<div class=\"container\">\r\n  <div class=\"upload-section\" *ngIf=\"!hideUpload\">\r\n    <label for=\"file-upload\" class=\"upload-btn\">Upload Excel</label>\r\n    <input type=\"file\" id=\"file-upload\" accept=\".xlsx,.xls,.csv\" (change)=\"onFileChange($event)\" hidden />\r\n    <button class=\"download-btn\" (click)=\"downloadExcel()\" [disabled]=\"!excelData.length\">Download Updated Excel</button>\r\n  </div>\r\n\r\n  <div *ngIf=\"sheetNames.length > 1\" class=\"sheet-selector\">\r\n    <label for=\"sheetSelect\">Select Sheet:</label>\r\n    <select id=\"sheetSelect\" (change)=\"onSheetChange($event)\" [value]=\"selectedSheet\">\r\n      <option *ngFor=\"let sheet of sheetNames\" [value]=\"sheet\">{{ sheet }}</option>\r\n    </select>\r\n  </div>\r\n\r\n  <div *ngIf=\"excelData.length > 0\" class=\"excel-wrapper\" [ngStyle]=\"{ width: containerWidth }\">\r\n    <div class=\"excel-toolbar\">\r\n      <button type=\"button\" class=\"tlb-btn\" title=\"Bold\" (click)=\"toggleBold()\"><strong>B</strong></button>\r\n      <div class=\"tlb-sep\"></div>\r\n      <button type=\"button\" class=\"tlb-btn\" title=\"Align left\" (click)=\"align('left')\">L</button>\r\n      <button type=\"button\" class=\"tlb-btn\" title=\"Align center\" (click)=\"align('center')\">C</button>\r\n      <button type=\"button\" class=\"tlb-btn\" title=\"Align right\" (click)=\"align('right')\">R</button>\r\n      <div class=\"tlb-sep\"></div>\r\n      <button type=\"button\" class=\"tlb-btn\" title=\"Wrap text\" (click)=\"toggleWrap()\">Wrap</button>\r\n      <div class=\"tlb-sep\"></div>\r\n      <button type=\"button\" class=\"tlb-btn\" title=\"AutoSum (Alt+=)\" (click)=\"addSumOverSelection()\">Sum</button>\r\n      <button type=\"button\" class=\"tlb-btn\" title=\"Average\" (click)=\"addAvgOverSelection()\">Avg</button>\r\n      <button type=\"button\" class=\"tlb-btn\" title=\"Count\" (click)=\"addCountOverSelection()\">Cnt</button>\r\n      <div class=\"tlb-grow\"></div>\r\n      <input class=\"name-box\" [value]=\"nameBox\" readonly aria-label=\"Cell address\" />\n      <input class=\"formula-input\" [(ngModel)]=\"formulaText\" (keyup.enter)=\"applyFormulaBar()\" (blur)=\"applyFormulaBar()\" placeholder=\"fx\" aria-label=\"Formula bar\" />\n      <button type=\"button\" class=\"tlb-btn\" title=\"Find (Ctrl+F)\" (click)=\"openFindPanel()\">Find</button>\n      <div class=\"find-panel\" *ngIf=\"showFind\">\n        <input #findInput class=\"find-input\" [(ngModel)]=\"findQuery\" (input)=\"runFind()\" (keyup.enter)=\"nextFind()\" placeholder=\"Find...\" />\n        <input class=\"replace-input\" [(ngModel)]=\"replaceText\" placeholder=\"Replace with...\" />\n        <label class=\"find-opt\"><input type=\"checkbox\" [(ngModel)]=\"findCaseSensitive\" (change)=\"runFind()\" /> Case</label>\n        <span class=\"find-count\">{{ findResults.length ? (currentFindIndex + 1) + '/' + findResults.length : '0/0' }}</span>\n        <button type=\"button\" class=\"tlb-btn\" (click)=\"prevFind()\">Prev</button>\n        <button type=\"button\" class=\"tlb-btn\" (click)=\"nextFind()\">Next</button>\n        <button type=\"button\" class=\"tlb-btn\" (click)=\"replaceCurrent()\" [disabled]=\"!findQuery\">Replace</button>\n        <button type=\"button\" class=\"tlb-btn\" (click)=\"replaceAllMatches()\" [disabled]=\"!findQuery\">Replace All</button>\n        <button type=\"button\" class=\"tlb-btn\" (click)=\"closeFindPanel()\">Close</button>\n      </div>\n    </div>\n    <div class=\"table-container\" [ngStyle]=\"{ height: containerHeight }\">\n      <hot-table #hotRef [hotId]=\"hotId\" class=\"hot-full\"\n        [data]=\"excelData\" [rowHeaders]=\"true\" [colHeaders]=\"true\"\n        [dropdownMenu]=\"true\" [filters]=\"true\" [search]=\"true\"\n        [contextMenu]=\"contextMenu\" [formulas]=\"formulas\" [licenseKey]=\"licenseKey\"\r\n        [copyPaste]=\"false\"\r\n        [stretchH]=\"'all'\" [manualColumnResize]=\"true\" [manualRowResize]=\"true\"\r\n        [manualColumnMove]=\"true\" [manualRowMove]=\"true\" [columnSorting]=\"true\"\r\n        [fillHandle]=\"true\" [fixedRowsTop]=\"headerRows\" [fixedColumnsLeft]=\"0\"\r\n        [outsideClickDeselects]=\"false\" [currentRowClassName]=\"'currentRow'\"\r\n        [currentColClassName]=\"'currentCol'\">\n      </hot-table>\n    </div>\n    <div class=\"status-bar\" aria-live=\"polite\">\n      <ng-container *ngIf=\"!selectionStats.hasNonNumeric && selectionStats.numericCount > 0; else countOnly\">\n        <div class=\"status-item\">\n          <span class=\"status-label\">Average</span>\n          <span class=\"status-value\">{{ selectionStats.average !== null ? (selectionStats.average | number:'1.0-4') : '\u2014' }}</span>\n        </div>\n        <div class=\"status-item\">\n          <span class=\"status-label\">Count</span>\n          <span class=\"status-value\">{{ selectionStats.count }}</span>\n        </div>\n        <div class=\"status-item\">\n          <span class=\"status-label\">Sum</span>\n          <span class=\"status-value\">{{ selectionStats.numericCount ? (selectionStats.sum | number:'1.0-4') : '\u2014' }}</span>\n        </div>\n      </ng-container>\n      <ng-template #countOnly>\n        <div class=\"status-item\">\n          <span class=\"status-label\">Count</span>\n          <span class=\"status-value\">{{ selectionStats.count }}</span>\n        </div>\n      </ng-template>\n    </div>\n  </div>\n</div>\n", styles: [".container{padding:16px;font-family:Arial,sans-serif}.upload-section{display:flex;gap:12px;margin-bottom:12px}.upload-btn{background-color:#4caf50;color:#fff;padding:8px 14px;border-radius:6px;cursor:pointer}.download-btn{background-color:#2196f3;color:#fff;padding:8px 14px;border-radius:6px;cursor:pointer;border:none}.download-btn:disabled{background-color:#ccc;cursor:not-allowed}.sheet-selector{margin-bottom:12px}.table-container{border:1px solid #ddd;box-shadow:0 2px 6px #0000001a;height:70vh;overflow:auto}.excel-wrapper{max-width:100%;margin:0 auto}.excel-toolbar{display:flex;align-items:center;gap:6px;padding:6px 0 4px}.tlb-btn{padding:4px 8px;border:1px solid #d0d0d0;border-radius:4px;background:#f7f7f7;cursor:pointer}.tlb-btn:hover{background:#efefef}.tlb-sep{width:1px;height:20px;background:#ddd;margin:0 4px}.tlb-grow{flex:1 1 auto}.formula-bar{display:grid;grid-template-columns:90px 1fr;gap:8px;align-items:center;padding:8px 0}.name-box{border:1px solid #ccc;border-radius:4px;padding:6px 8px;background:#f7f7f7;font-weight:600;width:4%}.formula-input{border:1px solid #ccc;border-radius:4px;padding:6px 10px;width:13%}.hot-full{display:block;width:100%;height:100%}.status-bar{display:flex;justify-content:flex-end;align-items:center;gap:24px;padding:6px 12px;border:1px solid #dcdcdc;border-top:none;background:#f6f7fb;font-size:13px;color:#222;font-family:Segoe UI,Arial,sans-serif}.status-item{display:inline-flex;gap:6px;align-items:baseline}.status-label{font-size:12px;text-transform:uppercase;letter-spacing:.5px;color:#5f5f5f}.status-value{min-width:56px;text-align:right;font-weight:600}:host ::ng-deep .handsontable thead th{background:#f3f3f3;border-bottom:1px solid #d9d9d9}:host ::ng-deep .handsontable .ht_clone_top thead th{background:#f3f3f3}:host ::ng-deep .handsontable .currentRow td{background:#f9fbff!important}:host ::ng-deep .handsontable .currentCol{background:#f9fbff!important}:host ::ng-deep .handsontable .htBold{font-weight:700}:host ::ng-deep .handsontable .htSearchResult{background-color:#fff2a8!important}.find-panel{display:inline-flex;align-items:center;flex-wrap:wrap;gap:6px;padding:6px 8px;border:1px solid #ddd;border-radius:6px;background:#fff;box-shadow:0 2px 6px #00000014;margin:6px 0}.find-input{border:1px solid #ccc;border-radius:4px;padding:6px 8px;min-width:220px}.replace-input{border:1px solid #ccc;border-radius:4px;padding:6px 8px;min-width:180px}.find-opt{display:inline-flex;align-items:center;gap:4px;font-size:12px;color:#555}.find-count{font-size:12px;color:#666}:host ::ng-deep .handsontable .htCore tbody tr:nth-child(1) td{font-weight:600;font-weight:700;background-color:#b1c8c9}\n"] }]
        }], propDecorators: { griddata: [{
                type: Input
            }], data: [{
                type: Input
            }], columns: [{
                type: Input
            }], sheetName: [{
                type: Input
            }], hideUpload: [{
                type: Input
            }], excludeColumns: [{
                type: Input
            }], containerHeight: [{
                type: Input
            }], containerWidth: [{
                type: Input
            }], headerRows: [{
                type: Input
            }], hotComponent: [{
                type: ViewChild,
                args: ['hotRef', { static: false }]
            }], findInput: [{
                type: ViewChild,
                args: ['findInput']
            }] } });
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZXhjZWxpZnkuY29tcG9uZW50LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vcHJvamVjdHMvZXhjZWxpZnkvc3JjL2xpYi9leGNlbGlmeS5jb21wb25lbnQudHMiLCIuLi8uLi8uLi8uLi9wcm9qZWN0cy9leGNlbGlmeS9zcmMvbGliL2V4Y2VsaWZ5LmNvbXBvbmVudC5odG1sIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLE9BQU8sRUFBRSxTQUFTLEVBQUUsS0FBSyxFQUE0QixTQUFTLEVBQTZCLE1BQU0sZUFBZSxDQUFDO0FBQ2pILE9BQU8sRUFBRSxZQUFZLEVBQUUsTUFBTSxpQkFBaUIsQ0FBQztBQUMvQyxPQUFPLEVBQUUsY0FBYyxFQUFxQixrQkFBa0IsRUFBRSxNQUFNLHVCQUF1QixDQUFDO0FBRTlGLE9BQU8sRUFBRSxZQUFZLEVBQUUsTUFBTSxjQUFjLENBQUM7QUFDNUMsT0FBTyxLQUFLLElBQUksTUFBTSxNQUFNLENBQUM7QUFDN0IsT0FBTyxFQUFFLE1BQU0sRUFBRSxNQUFNLFlBQVksQ0FBQztBQUNwQyxPQUFPLEVBQUUsV0FBVyxFQUFFLE1BQU0sZ0JBQWdCLENBQUM7Ozs7O0FBUzdDLE1BQU0sT0FBTyxpQkFBaUI7SUFDNUIsU0FBUyxHQUFZLEVBQUUsQ0FBQztJQUVmLFFBQVEsQ0FBTTtJQUVmLFFBQVEsQ0FBaUI7SUFDakMsVUFBVSxHQUFhLEVBQUUsQ0FBQztJQUMxQixhQUFhLEdBQUcsRUFBRSxDQUFDO0lBRW5CLHVEQUF1RDtJQUMvQyxFQUFFLEdBQUcsWUFBWSxDQUFDLFVBQVUsQ0FBQyxFQUFFLFVBQVUsRUFBRSxRQUFRLEVBQUUsQ0FBQyxDQUFDO0lBQy9ELFFBQVEsR0FBUSxFQUFFLE1BQU0sRUFBRSxJQUFJLENBQUMsRUFBRSxFQUFFLENBQUM7SUFDdEMsYUFBYTtJQUNYLGtEQUFrRDtJQUNsRCxXQUFXLEdBQXlEO1FBQ2xFLFdBQVc7UUFDWCxXQUFXO1FBQ1gsVUFBVTtRQUNWLFdBQVc7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U0FBUztzQkFBaEMsU0FBUzt1QkFBQyxXQUFXIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgQ29tcG9uZW50LCBJbnB1dCwgT25DaGFuZ2VzLCBTaW1wbGVDaGFuZ2VzLCBWaWV3Q2hpbGQsIEFmdGVyVmlld0luaXQsIEVsZW1lbnRSZWYgfSBmcm9tICdAYW5ndWxhci9jb3JlJztcclxuaW1wb3J0IHsgQ29tbW9uTW9kdWxlIH0gZnJvbSAnQGFuZ3VsYXIvY29tbW9uJztcclxuaW1wb3J0IHsgSG90VGFibGVNb2R1bGUsIEhvdFRhYmxlQ29tcG9uZW50LCBIb3RUYWJsZVJlZ2lzdGVyZXIgfSBmcm9tICdAaGFuZHNvbnRhYmxlL2FuZ3VsYXInO1xyXG5pbXBvcnQgSGFuZHNvbnRhYmxlIGZyb20gJ2hhbmRzb250YWJsZSc7XHJcbmltcG9ydCB7IEh5cGVyRm9ybXVsYSB9IGZyb20gJ2h5cGVyZm9ybXVsYSc7XHJcbmltcG9ydCAqIGFzIFhMU1ggZnJvbSAneGxzeCc7XHJcbmltcG9ydCB7IHNhdmVBcyB9IGZyb20gJ2ZpbGUtc2F2ZXInO1xyXG5pbXBvcnQgeyBGb3Jtc01vZHVsZSB9IGZyb20gJ0Bhbmd1bGFyL2Zvcm1zJztcclxuXHJcbkBDb21wb25lbnQoe1xuICBzZWxlY3RvcjogJ2VxLWV4Y2VsaWZ5JyxcbiAgc3RhbmRhbG9uZTogdHJ1ZSxcbiAgaW1wb3J0czogW0NvbW1vbk1vZHVsZSwgSG90VGFibGVNb2R1bGUsIEZvcm1zTW9kdWxlXSxcbiAgdGVtcGxhdGVVcmw6ICcuL2V4Y2VsaWZ5LmNvbXBvbmVudC5odG1sJyxcbiAgc3R5bGVVcmxzOiBbJy4vZXhjZWxpZnkuY29tcG9uZW50LnNjc3MnXSxcbn0pXG5leHBvcnQgY2xhc3MgRXhjZWxpZnlDb21wb25lbnQgaW1wbGVtZW50cyBBZnRlclZpZXdJbml0IHtcbiAgZXhjZWxEYXRhOiBhbnlbXVtdID0gW107XHJcblxyXG4gIEBJbnB1dCgpIGdyaWRkYXRhOiBhbnk7XHJcblxyXG4gIHByaXZhdGUgd29ya2Jvb2s/OiBYTFNYLldvcmtCb29rO1xyXG4gIHNoZWV0TmFtZXM6IHN0cmluZ1tdID0gW107XHJcbiAgc2VsZWN0ZWRTaGVldCA9ICcnO1xyXG5cclxuICAvLyBIeXBlckZvcm11bGEgZW5naW5lIGluc3RhbmNlIChSRVFVSVJFRCBmb3IgZm9ybXVsYXMpXHJcbiAgcHJpdmF0ZSBoZiA9IEh5cGVyRm9ybXVsYS5idWlsZEVtcHR5KHsgbGljZW5zZUtleTogJ2dwbC12MycgfSk7XHJcbiAgZm9ybXVsYXM6IGFueSA9IHsgZW5naW5lOiB0aGlzLmhmIH07XHJcbi8vIEB0cy1pZ25vcmVcclxuICAvLyBTaG93IGluc2VydC9kZWxldGUgcm93L2NvbCBldGMuIGluIGNvbnRleHQgbWVudVxyXG4gIGNvbnRleHRNZW51OiBIYW5kc29udGFibGUuY29udGV4dE1lbnUuU2V0dGluZ3NbJ2l0ZW1zJ10gfCBib29sZWFuID0gW1xyXG4gICAgJ3Jvd19hYm92ZScsXHJcbiAgICAncm93X2JlbG93JyxcclxuICAgICdjb2xfbGVmdCcsXHJcbiAgICAnY29sX3JpZ2h0JyxcclxuICAgICdyZW1vdmVfcm93JyxcclxuICAgICdyZW1vdmVfY29sJyxcclxuICAgICctLS0tLS0tLS0nLFxyXG4gICAgJ3VuZG8nLFxyXG4gICAgJ3JlZG8nLFxyXG4gICAgLy8gJ2NvcHknLCAgaWYgeW91IHdhbnQgdG8gZW5hYmxlIGEgY29weSBjdXQgXHJcbiAgICAvLyAnY3V0JyxcclxuICAgICdhbGlnbm1lbnQnLFxyXG4gIF07XHJcblxyXG4gIC8vIEhhbmRzb250YWJsZSBsaWNlbnNlIChkZXYvZXZhbClcclxuICBsaWNlbnNlS2V5ID0gJ25vbi1jb21tZXJjaWFsLWFuZC1ldmFsdWF0aW9uJztcclxuXHJcbiAgQElucHV0KCkgZGF0YT86IGFueVtdO1xyXG4gIEBJbnB1dCgpIGNvbHVtbnM/OiB7IGZpZWxkOiBzdHJpbmc7IGhlYWRlcj86IHN0cmluZyB9W107XHJcbiAgQElucHV0KCkgc2hlZXROYW1lPzogc3RyaW5nO1xyXG4gIEBJbnB1dCgpIGhpZGVVcGxvYWQgPSBmYWxzZTtcclxuICAvLyBFeGNsdWRlIGNvbHVtbnMgYnkgZmllbGQgb3IgaGVhZGVyIHRleHQgKGNhc2UtaW5zZW5zaXRpdmUpXHJcbiAgQElucHV0KCkgZXhjbHVkZUNvbHVtbnM6IHN0cmluZ1tdID0gW107XHJcbiAgLy8gQ29uc3RyYWluZWQgY29udGFpbmVyIHNpemUgKGN1c3RvbWl6YWJsZSBieSBwYXJlbnQpXHJcbiAgQElucHV0KCkgY29udGFpbmVySGVpZ2h0OiBzdHJpbmcgPSAnNzB2aCc7XHJcbiAgQElucHV0KCkgY29udGFpbmVyV2lkdGg6IHN0cmluZyA9ICcxMDAlJztcclxuICAvLyBOdW1iZXIgb2YgdG9wIHJvd3MgdG8gdHJlYXQgYXMgaGVhZGVycyAobm90IHNvcnRhYmxlKVxyXG4gIEBJbnB1dCgpIGhlYWRlclJvd3M6IG51bWJlciA9IDE7XHJcbiAgXHJcbiAgQFZpZXdDaGlsZCgnaG90UmVmJywgeyBzdGF0aWM6IGZhbHNlIH0pIGhvdENvbXBvbmVudD86IEhvdFRhYmxlQ29tcG9uZW50O1xyXG4gIHByaXZhdGUgaG90PzogSGFuZHNvbnRhYmxlO1xyXG4gIHByaXZhdGUgaG90UmVnaXN0ZXJlciA9IG5ldyBIb3RUYWJsZVJlZ2lzdGVyZXIoKTtcclxuICBob3RJZCA9ICdleGNlbGlmeUhvdCc7XG4gIHNlbGVjdGVkUm93ID0gMDtcbiAgc2VsZWN0ZWRDb2wgPSAwO1xuICBuYW1lQm94ID0gJ0ExJztcbiAgZm9ybXVsYVRleHQgPSAnJztcbiAgc2VsZWN0aW9uU3RhdHM6IHsgc3VtOiBudW1iZXI7IGF2ZXJhZ2U6IG51bWJlciB8IG51bGw7IG51bWVyaWNDb3VudDogbnVtYmVyOyBjb3VudDogbnVtYmVyOyBoYXNOb25OdW1lcmljOiBib29sZWFuIH0gPSB7XG4gICAgc3VtOiAwLFxuICAgIGF2ZXJhZ2U6IG51bGwsXG4gICAgbnVtZXJpY0NvdW50OiAwLFxuICAgIGNvdW50OiAwLFxuICAgIGhhc05vbk51bWVyaWM6IGZhbHNlLFxuICB9O1xuICAvLyBGaW5kIHBhbmVsIHN0YXRlXG4gIHNob3dGaW5kID0gZmFsc2U7XG4gIGZpbmRRdWVyeSA9ICcnO1xuICBmaW5kQ2FzZVNlbnNpdGl2ZSA9IGZhbHNlO1xuICBmaW5kUmVzdWx0czogeyByb3c6IG51bWJlcjsgY29sOiBudW1iZXIgfVtdID0gW107XG4gIGN1cnJlbnRGaW5kSW5kZXggPSAwO1xuICBAVmlld0NoaWxkKCdmaW5kSW5wdXQnKSBmaW5kSW5wdXQ/OiBFbGVtZW50UmVmPEhUTUxJbnB1dEVsZW1lbnQ+O1xuICBwcml2YXRlIGxhc3RTZWxlY3Rpb246IHsgcjE6IG51bWJlcjsgYzE6IG51bWJlcjsgcjI6IG51bWJlcjsgYzI6IG51bWJlciB9IHwgbnVsbCA9IG51bGw7XG4gIHJlcGxhY2VUZXh0ID0gJyc7XG5cclxuICBuZ0FmdGVyVmlld0luaXQoKTogdm9pZCB7XHJcbiAgICB0aGlzLmhvdCA9IHRoaXMuaG90UmVnaXN0ZXJlci5nZXRJbnN0YW5jZSh0aGlzLmhvdElkKSBhcyBIYW5kc29udGFibGUgfCB1bmRlZmluZWQ7XHJcbiAgICBpZiAoIXRoaXMuaG90KSB7XHJcbiAgICAgIHRoaXMuaG90ID0gKHRoaXMuaG90Q29tcG9uZW50IGFzIGFueSk/LmhvdEluc3RhbmNlIGFzIEhhbmRzb250YWJsZSB8IHVuZGVmaW5lZDtcclxuICAgIH1cclxuICAgIGlmICh0aGlzLmhvdCkge1xyXG4gICAgICB0aGlzLmhvdC5hZGRIb29rKCdhZnRlclNlbGVjdGlvbicsIChyOiBudW1iZXIsIGM6IG51bWJlciwgcjI/OiBudW1iZXIsIGMyPzogbnVtYmVyKSA9PiB7XG4gICAgICAgIHRoaXMuaGFuZGxlU2VsZWN0aW9uQ2hhbmdlKHIsIGMsIHIyLCBjMik7XG4gICAgICB9KTtcbiAgICAgIHRoaXMuaG90LmFkZEhvb2soJ2FmdGVyU2VsZWN0aW9uRW5kJywgKHI6IG51bWJlciwgYzogbnVtYmVyLCByMj86IG51bWJlciwgYzI/OiBudW1iZXIpID0+IHtcbiAgICAgICAgdGhpcy5oYW5kbGVTZWxlY3Rpb25DaGFuZ2UociwgYywgcjIsIGMyKTtcbiAgICAgIH0pO1xuICAgICAgdGhpcy5ob3QuYWRkSG9vaygnYWZ0ZXJPbkNlbGxNb3VzZURvd24nLCAoKSA9PiB0aGlzLnN5bmNTZWxlY3Rpb25Gcm9tTGFzdFJhbmdlKCkpO1xuICAgICAgdGhpcy5ob3QuYWRkSG9vaygnYWZ0ZXJPbkNlbGxNb3VzZVVwJywgKCkgPT4gdGhpcy5zeW5jU2VsZWN0aW9uRnJvbUxhc3RSYW5nZSgpKTtcbiAgICAgIHRoaXMuaG90LmFkZEhvb2soJ2FmdGVyQ2hhbmdlJywgKCkgPT4ge1xuICAgICAgICB0aGlzLnVwZGF0ZVNlbGVjdGlvbih0aGlzLnNlbGVjdGVkUm93LCB0aGlzLnNlbGVjdGVkQ29sKTtcbiAgICAgIH0pO1xuICAgICAgLy8gQWx0Kz0gYXV0b3N1bSBzaG9ydGN1dCwgQ3RybC9DbWQrRiBvcGVuIEZpbmQsIEVzYyBjbG9zZSBGaW5kXHJcbiAgICAgIHRoaXMuaG90LmFkZEhvb2soJ2JlZm9yZUtleURvd24nLCAoZTogS2V5Ym9hcmRFdmVudCkgPT4ge1xyXG4gICAgICAgIGlmICghZSkgcmV0dXJuO1xyXG4gICAgICAgIGNvbnN0IGtleSA9IChlIGFzIGFueSkua2V5IGFzIHN0cmluZztcclxuICAgICAgICBjb25zdCBjb2RlID0gKGUgYXMgYW55KS5jb2RlIGFzIHN0cmluZztcclxuICAgICAgICAvLyBCbG9jayBjb3B5L2N1dCBzaG9ydGN1dHMgaW5zaWRlIHRoZSBncmlkXHJcbiAgICAgICAgY29uc3QgaXNDdHJsTGlrZSA9IChlIGFzIGFueSkuY3RybEtleSB8fCAoZSBhcyBhbnkpLm1ldGFLZXk7XHJcbiAgICAgICAgY29uc3QgayA9IChrZXkgfHwgJycpLnRvTG93ZXJDYXNlKCk7XHJcbiAgICAgICAgaWYgKGlzQ3RybExpa2UgJiYgKGsgPT09ICdjJyB8fCBjb2RlID09PSAnS2V5QycgfHwga2V5ID09PSAnSW5zZXJ0JykpIHtcclxuICAgICAgICAgIGUucHJldmVudERlZmF1bHQoKTtcclxuICAgICAgICAgIGUuc3RvcFByb3BhZ2F0aW9uKCk7XHJcbiAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGlmIChpc0N0cmxMaWtlICYmIChrID09PSAneCcgfHwgY29kZSA9PT0gJ0tleVgnKSkge1xyXG4gICAgICAgICAgZS5wcmV2ZW50RGVmYXVsdCgpO1xyXG4gICAgICAgICAgZS5zdG9wUHJvcGFnYXRpb24oKTtcclxuICAgICAgICAgIHJldHVybjtcclxuICAgICAgICB9XHJcbiAgICAgICAgaWYgKChlIGFzIGFueSkuYWx0S2V5ICYmIChrZXkgPT09ICc9JyB8fCBjb2RlID09PSAnRXF1YWwnKSkge1xyXG4gICAgICAgICAgZS5wcmV2ZW50RGVmYXVsdCgpO1xyXG4gICAgICAgICAgdGhpcy5hZGRTdW1PdmVyU2VsZWN0aW9uKCk7XHJcbiAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGlmICgoKGUgYXMgYW55KS5jdHJsS2V5IHx8IChlIGFzIGFueSkubWV0YUtleSkgJiYgKGtleT8udG9Mb3dlckNhc2UoKSA9PT0gJ2YnKSkge1xyXG4gICAgICAgICAgZS5wcmV2ZW50RGVmYXVsdCgpO1xyXG4gICAgICAgICAgdGhpcy5vcGVuRmluZFBhbmVsKCk7XHJcbiAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGlmIChrZXkgPT09ICdFc2NhcGUnICYmIHRoaXMuc2hvd0ZpbmQpIHtcclxuICAgICAgICAgIGUucHJldmVudERlZmF1bHQoKTtcclxuICAgICAgICAgIHRoaXMuY2xvc2VGaW5kUGFuZWwoKTtcclxuICAgICAgICB9XHJcbiAgICAgIH0pO1xyXG5cclxuICAgICAgLy8gQmxvY2sgcHJvZ3JhbW1hdGljIGNvcHkvY3V0IGZyb20gSGFuZHNvbnRhYmxlIGNsaXBib2FyZCBwaXBlbGluZVxyXG4gICAgICB0aGlzLmhvdC5hZGRIb29rKCdiZWZvcmVDb3B5JywgKCkgPT4gZmFsc2UpO1xyXG4gICAgICB0aGlzLmhvdC5hZGRIb29rKCdiZWZvcmVDdXQnLCAoKSA9PiBmYWxzZSk7XHJcblxyXG4gICAgICAvLyBTb3J0IG9ubHkgZGF0YSByb3dzLCBrZWVwIHRoZSBmaXJzdCBgaGVhZGVyUm93c2AgYXQgdGhlIHRvcFxyXG4gICAgICB0aGlzLmhvdC5hZGRIb29rKCdiZWZvcmVDb2x1bW5Tb3J0JywgKF9jdXJyZW50Q2ZnOiBhbnksIGRlc3RpbmF0aW9uQ2ZnOiBhbnkpID0+IHtcclxuICAgICAgICBjb25zdCBjZmcgPSBBcnJheS5pc0FycmF5KGRlc3RpbmF0aW9uQ2ZnKSA/IGRlc3RpbmF0aW9uQ2ZnWzBdIDogZGVzdGluYXRpb25DZmc7XHJcbiAgICAgICAgaWYgKCFjZmcgfHwgY2ZnLmNvbHVtbiA9PSBudWxsKSByZXR1cm47IC8vIGFsbG93IGRlZmF1bHQgaWYgdW5rbm93blxyXG4gICAgICAgIGNvbnN0IGNvbEluZGV4ID0gdHlwZW9mIGNmZy5jb2x1bW4gPT09ICdudW1iZXInID8gY2ZnLmNvbHVtbiA6IChjZmcuY29sdW1uPy52aXN1YWxJbmRleCA/PyBjZmcuY29sdW1uKTtcclxuICAgICAgICBjb25zdCBvcmRlcjogJ2FzYycgfCAnZGVzYycgPSAoY2ZnLnNvcnRPcmRlciA9PT0gJ2Rlc2MnKSA/ICdkZXNjJyA6ICdhc2MnO1xyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICB0aGlzLnNvcnREYXRhUHJlc2VydmluZ0hlYWRlcihjb2xJbmRleCwgb3JkZXIpO1xyXG4gICAgICAgIH0gY2F0Y2ggKGUpIHtcclxuICAgICAgICAgIGNvbnNvbGUud2FybignQ3VzdG9tIHNvcnQgZmFpbGVkLCBmYWxsaW5nIGJhY2sgdG8gZGVmYXVsdCcsIGUpO1xyXG4gICAgICAgICAgcmV0dXJuOyAvLyBkZWZhdWx0IHdpbGwgcHJvY2VlZFxyXG4gICAgICAgIH1cclxuICAgICAgICByZXR1cm4gZmFsc2U7IC8vIGNhbmNlbCBkZWZhdWx0IHNvcnRpbmcgc2luY2Ugd2UgYXBwbGllZCBvdXIgb3duXHJcbiAgICAgIH0pO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgLy8gU29ydHMgcm93cyBiZWxvdyBgaGVhZGVyUm93c2AgYnkgdGhlIGdpdmVuIGNvbHVtbiwga2VlcGluZyBoZWFkZXIgcm93cyB1bmNoYW5nZWRcclxuICBwcml2YXRlIHNvcnREYXRhUHJlc2VydmluZ0hlYWRlcihjb2xJbmRleDogbnVtYmVyLCBvcmRlcjogJ2FzYycgfCAnZGVzYycpIHtcclxuICAgIGNvbnN0IGRhdGEgPSB0aGlzLmV4Y2VsRGF0YSB8fCBbXTtcclxuICAgIGNvbnN0IGhlYWRlckNvdW50ID0gTWF0aC5tYXgoMCwgTWF0aC5taW4odGhpcy5oZWFkZXJSb3dzLCBkYXRhLmxlbmd0aCkpO1xyXG4gICAgaWYgKGRhdGEubGVuZ3RoIDw9IGhlYWRlckNvdW50KSByZXR1cm47XHJcbiAgICBjb25zdCBoZWFkID0gZGF0YS5zbGljZSgwLCBoZWFkZXJDb3VudCk7XHJcbiAgICBjb25zdCBib2R5ID0gZGF0YS5zbGljZShoZWFkZXJDb3VudCk7XHJcbiAgICBjb25zdCBjb2xsYXRvciA9IG5ldyBJbnRsLkNvbGxhdG9yKHVuZGVmaW5lZCwgeyBudW1lcmljOiB0cnVlLCBzZW5zaXRpdml0eTogJ2Jhc2UnIH0pO1xyXG4gICAgY29uc3QgY21wID0gKGE6IGFueSwgYjogYW55KSA9PiB7XHJcbiAgICAgIGNvbnN0IHZhID0gYT8uW2NvbEluZGV4XTtcclxuICAgICAgY29uc3QgdmIgPSBiPy5bY29sSW5kZXhdO1xyXG4gICAgICBpZiAodmEgPT0gbnVsbCAmJiB2YiA9PSBudWxsKSByZXR1cm4gMDtcclxuICAgICAgaWYgKHZhID09IG51bGwpIHJldHVybiAxOyAvLyBudWxscyBsYXN0XHJcbiAgICAgIGlmICh2YiA9PSBudWxsKSByZXR1cm4gLTE7XHJcbiAgICAgIGNvbnN0IG5hID0gdHlwZW9mIHZhID09PSAnbnVtYmVyJyA/IHZhIDogTnVtYmVyKHZhKTtcclxuICAgICAgY29uc3QgbmIgPSB0eXBlb2YgdmIgPT09ICdudW1iZXInID8gdmIgOiBOdW1iZXIodmIpO1xyXG4gICAgICBsZXQgcmVzOiBudW1iZXI7XHJcbiAgICAgIGlmICghTnVtYmVyLmlzTmFOKG5hKSAmJiAhTnVtYmVyLmlzTmFOKG5iKSkgcmVzID0gbmEgLSBuYjsgZWxzZSByZXMgPSBjb2xsYXRvci5jb21wYXJlKFN0cmluZyh2YSksIFN0cmluZyh2YikpO1xyXG4gICAgICByZXR1cm4gb3JkZXIgPT09ICdhc2MnID8gcmVzIDogLXJlcztcclxuICAgIH07XHJcbiAgICBib2R5LnNvcnQoY21wKTtcclxuICAgIHRoaXMuZXhjZWxEYXRhID0gWy4uLmhlYWQsIC4uLmJvZHldO1xyXG4gICAgLy8gRW5zdXJlIEhhbmRzb250YWJsZSByZS1yZW5kZXJzIHdpdGggdXBkYXRlZCBkYXRhXHJcbiAgICBzZXRUaW1lb3V0KCgpID0+IHRoaXMuaG90Py5yZW5kZXIoKSk7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGNvbFRvTGV0dGVyKGNvbDogbnVtYmVyKTogc3RyaW5nIHtcclxuICAgIGxldCBzID0gJyc7XHJcbiAgICBsZXQgbiA9IGNvbCArIDE7XHJcbiAgICB3aGlsZSAobiA+IDApIHtcclxuICAgICAgY29uc3QgbW9kID0gKG4gLSAxKSAlIDI2O1xyXG4gICAgICBzID0gU3RyaW5nLmZyb21DaGFyQ29kZSg2NSArIG1vZCkgKyBzO1xyXG4gICAgICBuID0gTWF0aC5mbG9vcigobiAtIG1vZCkgLyAyNik7XHJcbiAgICB9XHJcbiAgICByZXR1cm4gcztcclxuICB9XHJcblxyXG4gIHByaXZhdGUgaGFuZGxlU2VsZWN0aW9uQ2hhbmdlKHIxOiBudW1iZXIsIGMxOiBudW1iZXIsIHIyPzogbnVtYmVyLCBjMj86IG51bWJlcikge1xuICAgIGNvbnN0IGVuZFJvdyA9IHIyID8/IHIxO1xuICAgIGNvbnN0IGVuZENvbCA9IGMyID8/IGMxO1xuICAgIHRoaXMubGFzdFNlbGVjdGlvbiA9IHtcbiAgICAgIHIxOiBNYXRoLm1pbihyMSwgZW5kUm93KSxcbiAgICAgIGMxOiBNYXRoLm1pbihjMSwgZW5kQ29sKSxcbiAgICAgIHIyOiBNYXRoLm1heChyMSwgZW5kUm93KSxcbiAgICAgIGMyOiBNYXRoLm1heChjMSwgZW5kQ29sKSxcbiAgICB9O1xuICAgIHRoaXMudXBkYXRlU2VsZWN0aW9uKHIxLCBjMSk7XG4gIH1cblxuICBwcml2YXRlIHVwZGF0ZVNlbGVjdGlvbihyb3c6IG51bWJlciwgY29sOiBudW1iZXIpIHtcbiAgICB0aGlzLnNlbGVjdGVkUm93ID0gcm93O1xuICAgIHRoaXMuc2VsZWN0ZWRDb2wgPSBjb2w7XG4gICAgdGhpcy5uYW1lQm94ID0gYCR7dGhpcy5jb2xUb0xldHRlcihjb2wpfSR7cm93ICsgMX1gO1xuICAgIGNvbnN0IHNyYyA9IHRoaXMuaG90Py5nZXRTb3VyY2VEYXRhQXRDZWxsKHJvdywgY29sKSBhcyBhbnk7XG4gICAgdGhpcy5mb3JtdWxhVGV4dCA9IHNyYyA9PSBudWxsID8gJycgOiBTdHJpbmcoc3JjKTtcbiAgICB0aGlzLnJlY2FsY3VsYXRlU2VsZWN0aW9uU3RhdHMoKTtcbiAgfVxuXG4gIHByaXZhdGUgc3luY1NlbGVjdGlvbkZyb21MYXN0UmFuZ2UoKSB7XG4gICAgaWYgKCF0aGlzLmhvdCkgcmV0dXJuO1xuICAgIC8vIEB0cy1pZ25vcmUgLSBkZXBlbmRpbmcgb24gSE9UIHZlcnNpb24gdGhpcyBtYXkgbm90IGJlIHR5cGVkXG4gICAgY29uc3QgcmFuZ2UgPSB0aGlzLmhvdC5nZXRTZWxlY3RlZFJhbmdlTGFzdD8uKCk7XG4gICAgaWYgKCFyYW5nZSkgcmV0dXJuO1xuICAgIHRoaXMuaGFuZGxlU2VsZWN0aW9uQ2hhbmdlKHJhbmdlLmZyb20ucm93LCByYW5nZS5mcm9tLmNvbCwgcmFuZ2UudG8ucm93LCByYW5nZS50by5jb2wpO1xuICB9XG5cbiAgcHJpdmF0ZSByZWNhbGN1bGF0ZVNlbGVjdGlvblN0YXRzKCkge1xuICAgIGlmICghdGhpcy5ob3QpIHtcbiAgICAgIHRoaXMuc2VsZWN0aW9uU3RhdHMgPSB7IHN1bTogMCwgYXZlcmFnZTogbnVsbCwgbnVtZXJpY0NvdW50OiAwLCBjb3VudDogMCwgaGFzTm9uTnVtZXJpYzogZmFsc2UgfTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgbGV0IHN1bSA9IDA7XG4gICAgbGV0IG51bWVyaWNDb3VudCA9IDA7XG4gICAgbGV0IHBvcHVsYXRlZENvdW50ID0gMDtcbiAgICBsZXQgaGFzTm9uTnVtZXJpYyA9IGZhbHNlO1xuICAgIHRoaXMuZm9yRWFjaENlbGxJblNlbGVjdGlvbigociwgYykgPT4ge1xuICAgICAgaWYgKHIgPT0gbnVsbCB8fCBjID09IG51bGwpIHJldHVybjtcbiAgICAgIGNvbnN0IHZhbCA9IHRoaXMuaG90IS5nZXREYXRhQXRDZWxsKHIsIGMpO1xuICAgICAgaWYgKCF0aGlzLmlzVmFsdWVFbXB0eSh2YWwpKSBwb3B1bGF0ZWRDb3VudCsrO1xuICAgICAgY29uc3QgbnVtZXJpYyA9IHRoaXMuY29lcmNlVG9OdW1iZXIodmFsKTtcbiAgICAgIGlmIChudW1lcmljICE9IG51bGwpIHtcbiAgICAgICAgc3VtICs9IG51bWVyaWM7XG4gICAgICAgIG51bWVyaWNDb3VudCsrO1xuICAgICAgfSBlbHNlIGlmICghdGhpcy5pc1ZhbHVlRW1wdHkodmFsKSkge1xuICAgICAgICBoYXNOb25OdW1lcmljID0gdHJ1ZTtcbiAgICAgIH1cbiAgICB9KTtcbiAgICB0aGlzLnNlbGVjdGlvblN0YXRzID0ge1xuICAgICAgc3VtOiBoYXNOb25OdW1lcmljID8gMCA6IChudW1lcmljQ291bnQgPyBzdW0gOiAwKSxcbiAgICAgIGF2ZXJhZ2U6ICFoYXNOb25OdW1lcmljICYmIG51bWVyaWNDb3VudCA/IHN1bSAvIG51bWVyaWNDb3VudCA6IG51bGwsXG4gICAgICBudW1lcmljQ291bnQsXG4gICAgICBjb3VudDogcG9wdWxhdGVkQ291bnQsXG4gICAgICBoYXNOb25OdW1lcmljLFxuICAgIH07XG4gIH1cblxuICBwcml2YXRlIGNvZXJjZVRvTnVtYmVyKHZhbHVlOiBhbnkpOiBudW1iZXIgfCBudWxsIHtcbiAgICBpZiAodmFsdWUgPT09ICcnIHx8IHZhbHVlID09PSBudWxsIHx8IHZhbHVlID09PSB1bmRlZmluZWQpIHJldHVybiBudWxsO1xuICAgIGlmICh0eXBlb2YgdmFsdWUgPT09ICdudW1iZXInICYmIE51bWJlci5pc0Zpbml0ZSh2YWx1ZSkpIHJldHVybiB2YWx1ZTtcbiAgICBjb25zdCBwYXJzZWQgPSBOdW1iZXIodmFsdWUpO1xuICAgIHJldHVybiBOdW1iZXIuaXNGaW5pdGUocGFyc2VkKSA/IHBhcnNlZCA6IG51bGw7XG4gIH1cblxuICBwcml2YXRlIGlzVmFsdWVFbXB0eSh2YWx1ZTogYW55KTogYm9vbGVhbiB7XG4gICAgaWYgKHZhbHVlID09PSBudWxsIHx8IHZhbHVlID09PSB1bmRlZmluZWQpIHJldHVybiB0cnVlO1xuICAgIGlmICh0eXBlb2YgdmFsdWUgPT09ICdzdHJpbmcnKSByZXR1cm4gdmFsdWUudHJpbSgpID09PSAnJztcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cblxyXG4gIGFwcGx5Rm9ybXVsYUJhcigpIHtcclxuICAgIGlmICghdGhpcy5ob3QpIHJldHVybjtcclxuICAgIHRoaXMuaG90LnNldERhdGFBdENlbGwodGhpcy5zZWxlY3RlZFJvdywgdGhpcy5zZWxlY3RlZENvbCwgdGhpcy5mb3JtdWxhVGV4dCk7XHJcbiAgfVxyXG5cclxuICAvLyA9PT09PSBFeGNlbC1saWtlIHRvb2xiYXIgYWN0aW9ucyA9PT09PVxyXG4gIHByaXZhdGUgZm9yRWFjaENlbGxJblNlbGVjdGlvbihjYjogKHI6IG51bWJlciwgYzogbnVtYmVyKSA9PiB2b2lkKSB7XG4gICAgaWYgKCF0aGlzLmhvdCkgcmV0dXJuO1xuICAgIC8vIEB0cy1pZ25vcmUgLSBnZXRTZWxlY3RlZFJhbmdlIG1heSBiZSB0eXBlZCBsb29zZWx5IGRlcGVuZGluZyBvbiB2ZXJzaW9uXG4gICAgY29uc3QgcmFuZ2VzID0gdGhpcy5ob3QuZ2V0U2VsZWN0ZWRSYW5nZT8uKCkgfHwgW107XG4gICAgaWYgKHJhbmdlcy5sZW5ndGgpIHtcbiAgICAgIHJhbmdlcy5mb3JFYWNoKChyYW5nZTogYW55KSA9PiB7XG4gICAgICAgIGNvbnN0IHIxID0gTWF0aC5taW4ocmFuZ2UuZnJvbS5yb3csIHJhbmdlLnRvLnJvdyk7XG4gICAgICAgIGNvbnN0IHIyID0gTWF0aC5tYXgocmFuZ2UuZnJvbS5yb3csIHJhbmdlLnRvLnJvdyk7XG4gICAgICAgIGNvbnN0IGMxID0gTWF0aC5taW4ocmFuZ2UuZnJvbS5jb2wsIHJhbmdlLnRvLmNvbCk7XG4gICAgICAgIGNvbnN0IGMyID0gTWF0aC5tYXgocmFuZ2UuZnJvbS5jb2wsIHJhbmdlLnRvLmNvbCk7XG4gICAgICAgIGZvciAobGV0IHIgPSByMTsgciA8PSByMjsgcisrKSB7XG4gICAgICAgICAgZm9yIChsZXQgYyA9IGMxOyBjIDw9IGMyOyBjKyspIHtcbiAgICAgICAgICAgIGNiKHIsIGMpO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGlmICh0aGlzLmxhc3RTZWxlY3Rpb24pIHtcbiAgICAgIGZvciAobGV0IHIgPSB0aGlzLmxhc3RTZWxlY3Rpb24ucjE7IHIgPD0gdGhpcy5sYXN0U2VsZWN0aW9uLnIyOyByKyspIHtcbiAgICAgICAgZm9yIChsZXQgYyA9IHRoaXMubGFzdFNlbGVjdGlvbi5jMTsgYyA8PSB0aGlzLmxhc3RTZWxlY3Rpb24uYzI7IGMrKykge1xuICAgICAgICAgIGNiKHIsIGMpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGNiKHRoaXMuc2VsZWN0ZWRSb3csIHRoaXMuc2VsZWN0ZWRDb2wpO1xuICB9XG5cclxuICBwcml2YXRlIHVwZGF0ZUNsYXNzT25TZWxlY3Rpb24oYWRkQ2xhc3Nlczogc3RyaW5nW10gPSBbXSwgcmVtb3ZlQ2xhc3Nlczogc3RyaW5nW10gPSBbXSkge1xyXG4gICAgaWYgKCF0aGlzLmhvdCkgcmV0dXJuO1xyXG4gICAgY29uc3QgYWRkU2V0ID0gbmV3IFNldChhZGRDbGFzc2VzLmZpbHRlcihCb29sZWFuKSk7XHJcbiAgICBjb25zdCByZW1vdmVTZXQgPSBuZXcgU2V0KHJlbW92ZUNsYXNzZXMuZmlsdGVyKEJvb2xlYW4pKTtcclxuICAgIHRoaXMuZm9yRWFjaENlbGxJblNlbGVjdGlvbigociwgYykgPT4ge1xyXG4gICAgICBjb25zdCBtZXRhID0gdGhpcy5ob3QhLmdldENlbGxNZXRhKHIsIGMpIGFzIGFueTtcclxuICAgICAgY29uc3QgZXhpc3RpbmcgPSAobWV0YS5jbGFzc05hbWUgfHwgJycpLnNwbGl0KC9cXHMrLykuZmlsdGVyKEJvb2xlYW4pO1xyXG4gICAgICBsZXQgc2V0ID0gbmV3IFNldChleGlzdGluZyk7XHJcbiAgICAgIHJlbW92ZVNldC5mb3JFYWNoKGNscyA9PiBzZXQuZGVsZXRlKGNscykpO1xyXG4gICAgICBhZGRTZXQuZm9yRWFjaChjbHMgPT4gc2V0LmFkZChjbHMpKTtcclxuICAgICAgY29uc3QgbmV4dCA9IEFycmF5LmZyb20oc2V0KS5qb2luKCcgJyk7XHJcbiAgICAgIHRoaXMuaG90IS5zZXRDZWxsTWV0YShyLCBjLCAnY2xhc3NOYW1lJywgbmV4dCk7XHJcbiAgICB9KTtcclxuICAgIHRoaXMuaG90LnJlbmRlcigpO1xyXG4gIH1cclxuXHJcbiAgdG9nZ2xlQm9sZCgpIHtcclxuICAgIGlmICghdGhpcy5ob3QpIHJldHVybjtcclxuICAgIC8vIFNpbXBsZSB0b2dnbGU6IGlmIGZpcnN0IGNlbGwgaGFzIGh0Qm9sZCB0aGVuIHJlbW92ZSwgZWxzZSBhZGRcclxuICAgIGNvbnN0IG1ldGEgPSB0aGlzLmhvdC5nZXRDZWxsTWV0YSh0aGlzLnNlbGVjdGVkUm93LCB0aGlzLnNlbGVjdGVkQ29sKSBhcyBhbnk7XHJcbiAgICBjb25zdCBoYXMgPSAobWV0YS5jbGFzc05hbWUgfHwgJycpLnNwbGl0KC9cXHMrLykuaW5jbHVkZXMoJ2h0Qm9sZCcpO1xyXG4gICAgaWYgKGhhcykgdGhpcy51cGRhdGVDbGFzc09uU2VsZWN0aW9uKFtdLCBbJ2h0Qm9sZCddKTsgZWxzZSB0aGlzLnVwZGF0ZUNsYXNzT25TZWxlY3Rpb24oWydodEJvbGQnXSk7XHJcbiAgfVxyXG5cclxuICBhbGlnbih3aGVyZTogJ2xlZnQnIHwgJ2NlbnRlcicgfCAncmlnaHQnKSB7XHJcbiAgICBjb25zdCBtYXA6IGFueSA9IHsgbGVmdDogJ2h0TGVmdCcsIGNlbnRlcjogJ2h0Q2VudGVyJywgcmlnaHQ6ICdodFJpZ2h0JyB9O1xyXG4gICAgdGhpcy51cGRhdGVDbGFzc09uU2VsZWN0aW9uKFttYXBbd2hlcmVdXSwgWydodExlZnQnLCAnaHRDZW50ZXInLCAnaHRSaWdodCddKTtcclxuICB9XHJcblxyXG4gIHRvZ2dsZVdyYXAoKSB7XHJcbiAgICBpZiAoIXRoaXMuaG90KSByZXR1cm47XHJcbiAgICBjb25zdCBtZXRhID0gdGhpcy5ob3QuZ2V0Q2VsbE1ldGEodGhpcy5zZWxlY3RlZFJvdywgdGhpcy5zZWxlY3RlZENvbCkgYXMgYW55O1xyXG4gICAgY29uc3QgaGFzID0gKG1ldGEuY2xhc3NOYW1lIHx8ICcnKS5zcGxpdCgvXFxzKy8pLmluY2x1ZGVzKCdodFdyYXAnKTtcclxuICAgIGlmIChoYXMpIHRoaXMudXBkYXRlQ2xhc3NPblNlbGVjdGlvbihbXSwgWydodFdyYXAnXSk7IGVsc2UgdGhpcy51cGRhdGVDbGFzc09uU2VsZWN0aW9uKFsnaHRXcmFwJ10pO1xyXG4gIH1cclxuXHJcbiAgLy8gPT09PT0gUXVpY2sgZnVuY3Rpb25zIGJhc2VkIG9uIGN1cnJlbnQgc2VsZWN0aW9uID09PT09XHJcbiAgcHJpdmF0ZSBnZXRGaXJzdFNlbGVjdGlvblJhbmdlKCkge1xyXG4gICAgLy8gQHRzLWlnbm9yZVxyXG4gICAgY29uc3QgcmFuZ2VzID0gdGhpcy5ob3Q/LmdldFNlbGVjdGVkUmFuZ2U/LigpO1xyXG4gICAgaWYgKCFyYW5nZXMgfHwgIXJhbmdlcy5sZW5ndGgpIHJldHVybiBudWxsO1xyXG4gICAgY29uc3QgciA9IHJhbmdlc1swXTtcclxuICAgIGNvbnN0IHIxID0gTWF0aC5taW4oci5mcm9tLnJvdywgci50by5yb3cpO1xyXG4gICAgY29uc3QgcjIgPSBNYXRoLm1heChyLmZyb20ucm93LCByLnRvLnJvdyk7XHJcbiAgICBjb25zdCBjMSA9IE1hdGgubWluKHIuZnJvbS5jb2wsIHIudG8uY29sKTtcclxuICAgIGNvbnN0IGMyID0gTWF0aC5tYXgoci5mcm9tLmNvbCwgci50by5jb2wpO1xyXG4gICAgcmV0dXJuIHsgcjEsIHIyLCBjMSwgYzIgfTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgcmFuZ2VUb0ExKHIxOiBudW1iZXIsIGMxOiBudW1iZXIsIHIyOiBudW1iZXIsIGMyOiBudW1iZXIpIHtcclxuICAgIGNvbnN0IHN0YXJ0ID0gYCR7dGhpcy5jb2xUb0xldHRlcihjMSl9JHtyMSArIDF9YDtcclxuICAgIGNvbnN0IGVuZCA9IGAke3RoaXMuY29sVG9MZXR0ZXIoYzIpfSR7cjIgKyAxfWA7XHJcbiAgICByZXR1cm4gcjEgPT09IHIyICYmIGMxID09PSBjMiA/IHN0YXJ0IDogYCR7c3RhcnR9OiR7ZW5kfWA7XHJcbiAgfVxyXG5cclxuICBhZGRTdW1PdmVyU2VsZWN0aW9uKCkge1xyXG4gICAgY29uc3Qgc2VsID0gdGhpcy5nZXRGaXJzdFNlbGVjdGlvblJhbmdlKCk7XHJcbiAgICBpZiAoIXNlbCkgcmV0dXJuO1xyXG4gICAgLy8gSWYgc2VsZWN0aW9uIGlzIGEgc2luZ2xlIGNlbGwgKGxpa2VseSBjdXJyZW50IGNlbGwpLCBkZWZhdWx0IHRvIHN1bW1pbmcgdGhlIGNvbHVtbiBhYm92ZSBpdCAoc2tpcCByb3cgMCBoZWFkZXIpXHJcbiAgICBpZiAoc2VsLnIxID09PSBzZWwucjIgJiYgc2VsLmMxID09PSBzZWwuYzIpIHtcclxuICAgICAgY29uc3QgY29sID0gdGhpcy5zZWxlY3RlZENvbDtcclxuICAgICAgY29uc3Qgc3RhcnRSb3cgPSAxOyAvLyBhc3N1bWUgZmlyc3Qgcm93IGlzIGhlYWRlciBpbiBvdXIgQU9BXHJcbiAgICAgIGNvbnN0IGVuZFJvdyA9IE1hdGgubWF4KHN0YXJ0Um93LCB0aGlzLnNlbGVjdGVkUm93IC0gMSk7XHJcbiAgICAgIGlmIChlbmRSb3cgPj0gc3RhcnRSb3cpIHtcclxuICAgICAgICBjb25zdCBhMWNvbCA9IHRoaXMucmFuZ2VUb0ExKHN0YXJ0Um93LCBjb2wsIGVuZFJvdywgY29sKTtcclxuICAgICAgICB0aGlzLmZvcm11bGFUZXh0ID0gYD1TVU0oJHthMWNvbH0pYDtcclxuICAgICAgICB0aGlzLmFwcGx5Rm9ybXVsYUJhcigpO1xyXG4gICAgICAgIHJldHVybjtcclxuICAgICAgfVxyXG4gICAgfVxyXG4gICAgLy8gSWYgY3VycmVudCBjZWxsIGlzIGluc2lkZSB0aGUgc2VsZWN0ZWQgcmFuZ2UsIGV4Y2x1ZGUgaXQgdG8gYXZvaWQgY2lyY3VsYXIgcmVmZXJlbmNlXHJcbiAgICBjb25zdCB3aXRoaW4gPSB0aGlzLnNlbGVjdGVkUm93ID49IHNlbC5yMSAmJiB0aGlzLnNlbGVjdGVkUm93IDw9IHNlbC5yMiAmJiB0aGlzLnNlbGVjdGVkQ29sID49IHNlbC5jMSAmJiB0aGlzLnNlbGVjdGVkQ29sIDw9IHNlbC5jMjtcclxuICAgIGNvbnN0IHN1bUFyZ3MgPSB3aXRoaW5cclxuICAgICAgPyB0aGlzLmJ1aWxkU3VtQXJnc0V4Y2x1ZGluZ0FjdGl2ZShzZWwucjEsIHNlbC5jMSwgc2VsLnIyLCBzZWwuYzIsIHRoaXMuc2VsZWN0ZWRSb3csIHRoaXMuc2VsZWN0ZWRDb2wpXHJcbiAgICAgIDogdGhpcy5yYW5nZVRvQTEoc2VsLnIxLCBzZWwuYzEsIHNlbC5yMiwgc2VsLmMyKTtcclxuICAgIHRoaXMuZm9ybXVsYVRleHQgPSBgPVNVTSgke3N1bUFyZ3N9KWA7XHJcbiAgICB0aGlzLmFwcGx5Rm9ybXVsYUJhcigpO1xyXG4gIH1cclxuXHJcbiAgYWRkQXZnT3ZlclNlbGVjdGlvbigpIHtcclxuICAgIGNvbnN0IHNlbCA9IHRoaXMuZ2V0Rmlyc3RTZWxlY3Rpb25SYW5nZSgpO1xyXG4gICAgaWYgKCFzZWwpIHJldHVybjtcclxuICAgIGlmIChzZWwucjEgPT09IHNlbC5yMiAmJiBzZWwuYzEgPT09IHNlbC5jMikge1xyXG4gICAgICBjb25zdCBjb2wgPSB0aGlzLnNlbGVjdGVkQ29sO1xyXG4gICAgICBjb25zdCBzdGFydFJvdyA9IDE7XHJcbiAgICAgIGNvbnN0IGVuZFJvdyA9IE1hdGgubWF4KHN0YXJ0Um93LCB0aGlzLnNlbGVjdGVkUm93IC0gMSk7XHJcbiAgICAgIGlmIChlbmRSb3cgPj0gc3RhcnRSb3cpIHtcclxuICAgICAgICBjb25zdCBhMWNvbCA9IHRoaXMucmFuZ2VUb0ExKHN0YXJ0Um93LCBjb2wsIGVuZFJvdywgY29sKTtcclxuICAgICAgICB0aGlzLmZvcm11bGFUZXh0ID0gYD1BVkVSQUdFKCR7YTFjb2x9KWA7XHJcbiAgICAgICAgdGhpcy5hcHBseUZvcm11bGFCYXIoKTtcclxuICAgICAgICByZXR1cm47XHJcbiAgICAgIH1cclxuICAgIH1cclxuICAgIGNvbnN0IHdpdGhpbiA9IHRoaXMuc2VsZWN0ZWRSb3cgPj0gc2VsLnIxICYmIHRoaXMuc2VsZWN0ZWRSb3cgPD0gc2VsLnIyICYmIHRoaXMuc2VsZWN0ZWRDb2wgPj0gc2VsLmMxICYmIHRoaXMuc2VsZWN0ZWRDb2wgPD0gc2VsLmMyO1xyXG4gICAgY29uc3QgYXJncyA9IHdpdGhpblxyXG4gICAgICA/IHRoaXMuYnVpbGRTdW1BcmdzRXhjbHVkaW5nQWN0aXZlKHNlbC5yMSwgc2VsLmMxLCBzZWwucjIsIHNlbC5jMiwgdGhpcy5zZWxlY3RlZFJvdywgdGhpcy5zZWxlY3RlZENvbClcclxuICAgICAgOiB0aGlzLnJhbmdlVG9BMShzZWwucjEsIHNlbC5jMSwgc2VsLnIyLCBzZWwuYzIpO1xyXG4gICAgdGhpcy5mb3JtdWxhVGV4dCA9IGA9QVZFUkFHRSgke2FyZ3N9KWA7XHJcbiAgICB0aGlzLmFwcGx5Rm9ybXVsYUJhcigpO1xyXG4gIH1cclxuXHJcbiAgYWRkQ291bnRPdmVyU2VsZWN0aW9uKCkge1xyXG4gICAgY29uc3Qgc2VsID0gdGhpcy5nZXRGaXJzdFNlbGVjdGlvblJhbmdlKCk7XHJcbiAgICBpZiAoIXNlbCkgcmV0dXJuO1xyXG4gICAgaWYgKHNlbC5yMSA9PT0gc2VsLnIyICYmIHNlbC5jMSA9PT0gc2VsLmMyKSB7XHJcbiAgICAgIGNvbnN0IGNvbCA9IHRoaXMuc2VsZWN0ZWRDb2w7XHJcbiAgICAgIGNvbnN0IHN0YXJ0Um93ID0gMTtcclxuICAgICAgY29uc3QgZW5kUm93ID0gTWF0aC5tYXgoc3RhcnRSb3csIHRoaXMuc2VsZWN0ZWRSb3cgLSAxKTtcclxuICAgICAgaWYgKGVuZFJvdyA+PSBzdGFydFJvdykge1xyXG4gICAgICAgIGNvbnN0IGExY29sID0gdGhpcy5yYW5nZVRvQTEoc3RhcnRSb3csIGNvbCwgZW5kUm93LCBjb2wpO1xyXG4gICAgICAgIHRoaXMuZm9ybXVsYVRleHQgPSBgPUNPVU5UKCR7YTFjb2x9KWA7XHJcbiAgICAgICAgdGhpcy5hcHBseUZvcm11bGFCYXIoKTtcclxuICAgICAgICByZXR1cm47XHJcbiAgICAgIH1cclxuICAgIH1cclxuICAgIGNvbnN0IHdpdGhpbiA9IHRoaXMuc2VsZWN0ZWRSb3cgPj0gc2VsLnIxICYmIHRoaXMuc2VsZWN0ZWRSb3cgPD0gc2VsLnIyICYmIHRoaXMuc2VsZWN0ZWRDb2wgPj0gc2VsLmMxICYmIHRoaXMuc2VsZWN0ZWRDb2wgPD0gc2VsLmMyO1xyXG4gICAgY29uc3QgYXJncyA9IHdpdGhpblxyXG4gICAgICA/IHRoaXMuYnVpbGRTdW1BcmdzRXhjbHVkaW5nQWN0aXZlKHNlbC5yMSwgc2VsLmMxLCBzZWwucjIsIHNlbC5jMiwgdGhpcy5zZWxlY3RlZFJvdywgdGhpcy5zZWxlY3RlZENvbClcclxuICAgICAgOiB0aGlzLnJhbmdlVG9BMShzZWwucjEsIHNlbC5jMSwgc2VsLnIyLCBzZWwuYzIpO1xyXG4gICAgdGhpcy5mb3JtdWxhVGV4dCA9IGA9Q09VTlQoJHthcmdzfSlgO1xyXG4gICAgdGhpcy5hcHBseUZvcm11bGFCYXIoKTtcclxuICB9XHJcblxyXG4gIC8vIEJ1aWxkIGNvbW1hLXNlcGFyYXRlZCBTVU0gYXJndW1lbnRzIGNvdmVyaW5nIGEgcmVjdGFuZ2xlIGJ1dCBleGNsdWRpbmcgdGhlIGFjdGl2ZSBjZWxsXHJcbiAgcHJpdmF0ZSBidWlsZFN1bUFyZ3NFeGNsdWRpbmdBY3RpdmUocjE6IG51bWJlciwgYzE6IG51bWJlciwgcjI6IG51bWJlciwgYzI6IG51bWJlciwgYXI6IG51bWJlciwgYWM6IG51bWJlcik6IHN0cmluZyB7XHJcbiAgICBjb25zdCBwYXJ0czogc3RyaW5nW10gPSBbXTtcclxuICAgIC8vIFRvcCBibG9jayAocm93cyBhYm92ZSBhY3RpdmUgcm93KVxyXG4gICAgaWYgKGFyIC0gMSA+PSByMSkge1xyXG4gICAgICBwYXJ0cy5wdXNoKHRoaXMucmFuZ2VUb0ExKHIxLCBjMSwgYXIgLSAxLCBjMikpO1xyXG4gICAgfVxyXG4gICAgLy8gQm90dG9tIGJsb2NrIChyb3dzIGJlbG93IGFjdGl2ZSByb3cpXHJcbiAgICBpZiAoYXIgKyAxIDw9IHIyKSB7XHJcbiAgICAgIHBhcnRzLnB1c2godGhpcy5yYW5nZVRvQTEoYXIgKyAxLCBjMSwgcjIsIGMyKSk7XHJcbiAgICB9XHJcbiAgICAvLyBTYW1lIHJvdzogbGVmdCBzZWdtZW50XHJcbiAgICBpZiAoYWMgLSAxID49IGMxKSB7XHJcbiAgICAgIHBhcnRzLnB1c2godGhpcy5yYW5nZVRvQTEoYXIsIGMxLCBhciwgYWMgLSAxKSk7XHJcbiAgICB9XHJcbiAgICAvLyBTYW1lIHJvdzogcmlnaHQgc2VnbWVudFxyXG4gICAgaWYgKGFjICsgMSA8PSBjMikge1xyXG4gICAgICBwYXJ0cy5wdXNoKHRoaXMucmFuZ2VUb0ExKGFyLCBhYyArIDEsIGFyLCBjMikpO1xyXG4gICAgfVxyXG4gICAgLy8gRmFsbGJhY2sgaWYgbm90aGluZyB3YXMgYWRkZWQgKHNob3VsZG4ndCBoYXBwZW4gdW5sZXNzIHNlbGVjdGlvbiBpcyBzaW5nbGUgY2VsbClcclxuICAgIHJldHVybiBwYXJ0cy5maWx0ZXIoQm9vbGVhbikuam9pbignLCcpO1xyXG4gIH1cclxuXHJcbiAgLy8gPT09PT0gRmluZCBwYW5lbCBsb2dpYyB1c2luZyBIYW5kc29udGFibGUgU2VhcmNoIHBsdWdpbiA9PT09PVxyXG4gIG9wZW5GaW5kUGFuZWwoKSB7XG4gICAgdGhpcy5zaG93RmluZCA9IHRydWU7XG4gICAgdGhpcy5mb2N1c0ZpbmRJbnB1dCgpO1xuICB9XG4gIGNsb3NlRmluZFBhbmVsKCkge1xuICAgIHRoaXMuc2hvd0ZpbmQgPSBmYWxzZTtcbiAgICB0aGlzLmNsZWFyRmluZCgpO1xuICB9XG4gIHJ1bkZpbmQoKSB7XG4gICAgaWYgKCF0aGlzLmhvdCkgcmV0dXJuO1xuICAgIGNvbnN0IHNob3VsZFJlZm9jdXMgPSB0aGlzLmlzRmluZElucHV0Rm9jdXNlZCgpO1xuICAgIC8vIFVzZSBzZWFyY2ggcGx1Z2luXG4gICAgLy8gQHRzLWlnbm9yZVxuICAgIGNvbnN0IHNlYXJjaCA9IHRoaXMuaG90LmdldFBsdWdpbignc2VhcmNoJyk7XG4gICAgY29uc3QgcXVlcnkgPSB0aGlzLmZpbmRRdWVyeSB8fCAnJztcbiAgICBjb25zdCBjbXAgPSAocTogc3RyaW5nLCB2YWx1ZTogYW55KSA9PiB7XG4gICAgICBpZiAoIXEpIHJldHVybiBmYWxzZTtcbiAgICAgIGNvbnN0IHZhbCA9IHZhbHVlID09IG51bGwgPyAnJyA6IFN0cmluZyh2YWx1ZSk7XG4gICAgICBpZiAodGhpcy5maW5kQ2FzZVNlbnNpdGl2ZSkgcmV0dXJuIHZhbC5pbmRleE9mKHEpICE9PSAtMTtcbiAgICAgIHJldHVybiB2YWwudG9Mb3dlckNhc2UoKS5pbmRleE9mKHEudG9Mb3dlckNhc2UoKSkgIT09IC0xO1xuICAgIH07XG4gICAgY29uc3QgcmVzdWx0cyA9IHNlYXJjaC5xdWVyeShxdWVyeSwgdW5kZWZpbmVkLCAocVN0cjogc3RyaW5nLCB2YWx1ZTogYW55KSA9PiBjbXAocVN0ciwgdmFsdWUpKSB8fCBbXTtcbiAgICB0aGlzLmZpbmRSZXN1bHRzID0gcmVzdWx0cy5tYXAoKHI6IGFueSkgPT4gKHsgcm93OiByLnJvdywgY29sOiByLmNvbCB9KSk7XG4gICAgdGhpcy5jdXJyZW50RmluZEluZGV4ID0gMDtcbiAgICBpZiAodGhpcy5maW5kUmVzdWx0cy5sZW5ndGgpIHRoaXMuZ290b0ZpbmRJbmRleCgwLCBzaG91bGRSZWZvY3VzKTtcbiAgICBlbHNlIGlmIChzaG91bGRSZWZvY3VzKSB0aGlzLmZvY3VzRmluZElucHV0KCk7XG4gICAgdGhpcy5ob3QucmVuZGVyKCk7XG4gIH1cbiAgY2xlYXJGaW5kKCkge1xyXG4gICAgdGhpcy5maW5kUXVlcnkgPSAnJztcclxuICAgIHRoaXMuZmluZFJlc3VsdHMgPSBbXTtcclxuICAgIHRoaXMuY3VycmVudEZpbmRJbmRleCA9IDA7XHJcbiAgICBpZiAodGhpcy5ob3QpIHtcclxuICAgICAgLy8gQ2xlYXIgaGlnaGxpZ2h0cyBieSBydW5uaW5nIGVtcHR5IHF1ZXJ5XHJcbiAgICAgIC8vIEB0cy1pZ25vcmVcclxuICAgICAgY29uc3Qgc2VhcmNoID0gdGhpcy5ob3QuZ2V0UGx1Z2luKCdzZWFyY2gnKTtcclxuICAgICAgc2VhcmNoLnF1ZXJ5KCcnKTtcclxuICAgICAgdGhpcy5ob3QucmVuZGVyKCk7XHJcbiAgICB9XHJcbiAgfVxyXG4gIGdvdG9GaW5kSW5kZXgoaWR4OiBudW1iZXIsIHJlZm9jdXMgPSBmYWxzZSkge1xuICAgIGlmICghdGhpcy5ob3QgfHwgIXRoaXMuZmluZFJlc3VsdHMubGVuZ3RoKSByZXR1cm47XG4gICAgY29uc3QgaGFkRmluZEZvY3VzID0gcmVmb2N1cyB8fCB0aGlzLmlzRmluZElucHV0Rm9jdXNlZCgpO1xuICAgIGNvbnN0IG4gPSB0aGlzLmZpbmRSZXN1bHRzLmxlbmd0aDtcbiAgICB0aGlzLmN1cnJlbnRGaW5kSW5kZXggPSAoKGlkeCAlIG4pICsgbikgJSBuOyAvLyB3cmFwXG4gICAgY29uc3QgeyByb3csIGNvbCB9ID0gdGhpcy5maW5kUmVzdWx0c1t0aGlzLmN1cnJlbnRGaW5kSW5kZXhdO1xuICAgIHRoaXMuaG90LnNlbGVjdENlbGwocm93LCBjb2wsIHJvdywgY29sLCB0cnVlLCB0cnVlKTtcbiAgICB0aGlzLnVwZGF0ZVNlbGVjdGlvbihyb3csIGNvbCk7XG4gICAgaWYgKGhhZEZpbmRGb2N1cykgdGhpcy5mb2N1c0ZpbmRJbnB1dCgpO1xuICB9XG4gIG5leHRGaW5kKCkgeyB0aGlzLmdvdG9GaW5kSW5kZXgodGhpcy5jdXJyZW50RmluZEluZGV4ICsgMSk7IH1cbiAgcHJldkZpbmQoKSB7IHRoaXMuZ290b0ZpbmRJbmRleCh0aGlzLmN1cnJlbnRGaW5kSW5kZXggLSAxKTsgfVxuXG4gIHByaXZhdGUgaXNGaW5kSW5wdXRGb2N1c2VkKCkge1xuICAgIGNvbnN0IGFjdGl2ZSA9IHR5cGVvZiBkb2N1bWVudCAhPT0gJ3VuZGVmaW5lZCcgPyBkb2N1bWVudC5hY3RpdmVFbGVtZW50IDogbnVsbDtcbiAgICByZXR1cm4gISEodGhpcy5maW5kSW5wdXQ/Lm5hdGl2ZUVsZW1lbnQgJiYgYWN0aXZlID09PSB0aGlzLmZpbmRJbnB1dC5uYXRpdmVFbGVtZW50KTtcbiAgfVxuXG4gIHByaXZhdGUgZm9jdXNGaW5kSW5wdXQoKSB7XG4gICAgc2V0VGltZW91dCgoKSA9PiB0aGlzLmZpbmRJbnB1dD8ubmF0aXZlRWxlbWVudD8uZm9jdXMoKSwgMCk7XG4gIH1cblxuICByZXBsYWNlQ3VycmVudCgpIHtcbiAgICBpZiAoIXRoaXMuaG90IHx8ICF0aGlzLmZpbmRRdWVyeSkgcmV0dXJuO1xuICAgIGlmICghdGhpcy5maW5kUmVzdWx0cy5sZW5ndGgpIHtcbiAgICAgIHRoaXMucnVuRmluZCgpO1xuICAgICAgaWYgKCF0aGlzLmZpbmRSZXN1bHRzLmxlbmd0aCkgcmV0dXJuO1xuICAgIH1cbiAgICBjb25zdCB7IHJvdywgY29sIH0gPSB0aGlzLmZpbmRSZXN1bHRzW3RoaXMuY3VycmVudEZpbmRJbmRleF07XG4gICAgY29uc3QgY3VycmVudFZhbHVlID0gdGhpcy5ob3QuZ2V0RGF0YUF0Q2VsbChyb3csIGNvbCk7XG4gICAgY29uc3QgbmV4dCA9IHRoaXMuYnVpbGRSZXBsYWNlbWVudChTdHJpbmcoY3VycmVudFZhbHVlID8/ICcnKSwgZmFsc2UpO1xuICAgIGlmIChuZXh0ID09PSBudWxsKSByZXR1cm47XG4gICAgdGhpcy5ob3Quc2V0RGF0YUF0Q2VsbChyb3csIGNvbCwgbmV4dCk7XG4gICAgdGhpcy5ob3QucmVuZGVyKCk7XG4gICAgdGhpcy5ydW5GaW5kKCk7XG4gIH1cblxuICByZXBsYWNlQWxsTWF0Y2hlcygpIHtcbiAgICBpZiAoIXRoaXMuaG90IHx8ICF0aGlzLmZpbmRRdWVyeSkgcmV0dXJuO1xuICAgIGNvbnN0IHJvd3MgPSB0aGlzLmhvdC5jb3VudFJvd3M/LigpID8/IDA7XG4gICAgY29uc3QgY29scyA9IHRoaXMuaG90LmNvdW50Q29scz8uKCkgPz8gMDtcbiAgICBpZiAoIXJvd3MgfHwgIWNvbHMpIHJldHVybjtcbiAgICBsZXQgZGlkUmVwbGFjZSA9IGZhbHNlO1xuICAgIGZvciAobGV0IHIgPSAwOyByIDwgcm93czsgcisrKSB7XG4gICAgICBmb3IgKGxldCBjID0gMDsgYyA8IGNvbHM7IGMrKykge1xuICAgICAgICBjb25zdCB2YWx1ZSA9IHRoaXMuaG90LmdldERhdGFBdENlbGwociwgYyk7XG4gICAgICAgIGNvbnN0IG5leHQgPSB0aGlzLmJ1aWxkUmVwbGFjZW1lbnQoU3RyaW5nKHZhbHVlID8/ICcnKSwgdHJ1ZSk7XG4gICAgICAgIGlmIChuZXh0ICE9PSBudWxsKSB7XG4gICAgICAgICAgdGhpcy5ob3Quc2V0RGF0YUF0Q2VsbChyLCBjLCBuZXh0KTtcbiAgICAgICAgICBkaWRSZXBsYWNlID0gdHJ1ZTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgICBpZiAoZGlkUmVwbGFjZSkge1xuICAgICAgdGhpcy5ob3QucmVuZGVyKCk7XG4gICAgfVxuICAgIHRoaXMucnVuRmluZCgpO1xuICB9XG5cbiAgcHJpdmF0ZSBidWlsZFJlcGxhY2VtZW50KHZhbHVlOiBzdHJpbmcsIGFsbE9jY3VycmVuY2VzOiBib29sZWFuKTogc3RyaW5nIHwgbnVsbCB7XG4gICAgY29uc3QgcXVlcnkgPSB0aGlzLmZpbmRRdWVyeTtcbiAgICBpZiAoIXF1ZXJ5KSByZXR1cm4gbnVsbDtcbiAgICBjb25zdCBmbGFncyA9IHRoaXMuZmluZENhc2VTZW5zaXRpdmUgPyAnJyA6ICdpJztcbiAgICBjb25zdCBlc2NhcGVkID0gdGhpcy5lc2NhcGVSZWdFeHAocXVlcnkpO1xuICAgIGNvbnN0IHJlID0gbmV3IFJlZ0V4cChlc2NhcGVkLCBhbGxPY2N1cnJlbmNlcyA/IGBnJHtmbGFnc31gIDogZmxhZ3MpO1xuICAgIGlmICghcmUudGVzdCh2YWx1ZSkpIHJldHVybiBudWxsO1xuICAgIHJlLmxhc3RJbmRleCA9IDA7IC8vIHJlc2V0IGZvciByZXVzZVxuICAgIHJldHVybiB2YWx1ZS5yZXBsYWNlKHJlLCB0aGlzLnJlcGxhY2VUZXh0ID8/ICcnKTtcbiAgfVxuXG4gIHByaXZhdGUgZXNjYXBlUmVnRXhwKHN0cjogc3RyaW5nKTogc3RyaW5nIHtcbiAgICByZXR1cm4gc3RyLnJlcGxhY2UoL1suKis/XiR7fSgpfFtcXF1cXFxcXS9nLCAnXFxcXCQmJyk7XG4gIH1cbiAgXHJcbiAgLy8gRW5zdXJlIGNlbGxzIGFyZSBwcmltaXRpdmVzIGFjY2VwdGFibGUgYnkgSGFuZHNvbnRhYmxlL0h5cGVyRm9ybXVsYVxyXG4gIHByaXZhdGUgc2FuaXRpemVDZWxsKHZhbHVlOiBhbnkpOiBzdHJpbmcgfCBudW1iZXIgfCBib29sZWFuIHwgbnVsbCB7XHJcbiAgICBpZiAodmFsdWUgPT09IG51bGwgfHwgdmFsdWUgPT09IHVuZGVmaW5lZCkgcmV0dXJuICcnO1xyXG4gICAgaWYgKEFycmF5LmlzQXJyYXkodmFsdWUpKSByZXR1cm4gdmFsdWUuam9pbignLCAnKTtcclxuICAgIGNvbnN0IHQgPSB0eXBlb2YgdmFsdWU7XHJcbiAgICBpZiAodCA9PT0gJ3N0cmluZycgfHwgdCA9PT0gJ251bWJlcicgfHwgdCA9PT0gJ2Jvb2xlYW4nKSByZXR1cm4gdmFsdWUgYXMgYW55O1xyXG4gICAgaWYgKHZhbHVlIGluc3RhbmNlb2YgRGF0ZSkgcmV0dXJuIHZhbHVlLnRvSVNPU3RyaW5nKCk7XHJcbiAgICB0cnkge1xyXG4gICAgICByZXR1cm4gSlNPTi5zdHJpbmdpZnkodmFsdWUpO1xyXG4gICAgfSBjYXRjaCB7XHJcbiAgICAgIHJldHVybiBTdHJpbmcodmFsdWUpO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBzYW5pdGl6ZUFvYShhb2E6IGFueVtdW10pOiAoc3RyaW5nIHwgbnVtYmVyIHwgYm9vbGVhbiB8IG51bGwpW11bXSB7XHJcbiAgICByZXR1cm4gKGFvYSB8fCBbXSkubWFwKHJvdyA9PiBBcnJheS5pc0FycmF5KHJvdykgPyByb3cubWFwKGMgPT4gdGhpcy5zYW5pdGl6ZUNlbGwoYykpIDogW3RoaXMuc2FuaXRpemVDZWxsKHJvdyldKTtcclxuICB9XHJcblxyXG4gIC8vIFJlbW92ZSBsZWFkaW5nIGVudGlyZWx5IGVtcHR5IHJvd3Mgc28gdGhlIGhlYWRlciBpcyBhdCB0aGUgdmVyeSB0b3BcclxuICBwcml2YXRlIHRyaW1MZWFkaW5nRW1wdHlSb3dzKGFvYTogKHN0cmluZyB8IG51bWJlciB8IGJvb2xlYW4gfCBudWxsKVtdW10pOiAoc3RyaW5nIHwgbnVtYmVyIHwgYm9vbGVhbiB8IG51bGwpW11bXSB7XHJcbiAgICBjb25zdCBpc0VtcHR5ID0gKHY6IGFueSkgPT4gdiA9PT0gJycgfHwgdiA9PT0gbnVsbCB8fCB2ID09PSB1bmRlZmluZWQ7XHJcbiAgICBsZXQgc3RhcnQgPSAwO1xyXG4gICAgd2hpbGUgKHN0YXJ0IDwgKGFvYT8ubGVuZ3RoIHx8IDApKSB7XHJcbiAgICAgIGNvbnN0IHJvdyA9IGFvYVtzdGFydF0gfHwgW107XHJcbiAgICAgIGlmIChyb3cuc29tZShjZWxsID0+ICFpc0VtcHR5KGNlbGwpKSkgYnJlYWs7XHJcbiAgICAgIHN0YXJ0Kys7XHJcbiAgICB9XHJcbiAgICByZXR1cm4gKGFvYSB8fCBbXSkuc2xpY2Uoc3RhcnQpO1xyXG4gIH1cclxuXHJcbiAgXHJcbiAgbmdPbkNoYW5nZXMoY2hhbmdlczogU2ltcGxlQ2hhbmdlcyk6IHZvaWQge1xyXG4gICAgaWYgKGNoYW5nZXNbJ2RhdGEnXSB8fCBjaGFuZ2VzWydjb2x1bW5zJ10gfHwgY2hhbmdlc1snc2hlZXROYW1lJ10pIHtcclxuICAgICAgY29uc29sZS5sb2coJ2NoYW5nZXMnLCBjaGFuZ2VzKVxyXG4gICAgICBpZiAoQXJyYXkuaXNBcnJheSh0aGlzLmRhdGEpICYmIHRoaXMuZGF0YS5sZW5ndGggPiAwKSB7XHJcbiAgICAgICAgdGhpcy5zZXRTaGVldEZyb21PYmplY3RzKHRoaXMuZGF0YSwgdGhpcy5jb2x1bW5zLCB0aGlzLnNoZWV0TmFtZSB8fCAnU2hlZXQxJyk7XHJcbiAgICAgIH0gZWxzZSBpZiAoQXJyYXkuaXNBcnJheSh0aGlzLmRhdGEpICYmIHRoaXMuZGF0YS5sZW5ndGggPT09IDApIHtcclxuICAgICAgICAvLyBJZiBleHBsaWNpdGx5IHBhc3NlZCBlbXB0eSBkYXRhLCBjbGVhciB0aGUgdGFibGVcclxuICAgICAgICB0aGlzLmV4Y2VsRGF0YSA9IFtdO1xyXG4gICAgICAgIHRoaXMud29ya2Jvb2sgPSB1bmRlZmluZWQ7XHJcbiAgICAgICAgdGhpcy5zaGVldE5hbWVzID0gW107XHJcbiAgICAgICAgdGhpcy5zZWxlY3RlZFNoZWV0ID0gJyc7XHJcbiAgICAgIH1cclxuICAgIH1cclxuICB9XHJcblxyXG4gIHNldFNoZWV0RnJvbU9iamVjdHMocm93czogYW55W10sIGNvbHM/OiB7IGZpZWxkOiBzdHJpbmc7IGhlYWRlcj86IHN0cmluZyB9W10sIG5hbWU6IHN0cmluZyA9ICdTaGVldDEnKSB7XHJcbiAgICBjb25zdCByZXNvbHZlZENvbHMgPSBjb2xzICYmIGNvbHMubGVuZ3RoXHJcbiAgICAgID8gY29scy5tYXAoYyA9PiAoeyBmaWVsZDogYy5maWVsZCwgaGVhZGVyOiBjLmhlYWRlciB8fCBjLmZpZWxkIH0pKVxyXG4gICAgICA6IE9iamVjdC5rZXlzKHJvd3NbMF0gfHwge30pLm1hcChrID0+ICh7IGZpZWxkOiBrLCBoZWFkZXI6IGsgfSkpO1xyXG5cclxuICAgIGNvbnN0IGV4Y2x1ZGVzID0gKHRoaXMuZXhjbHVkZUNvbHVtbnMgfHwgW10pLm1hcChlID0+IFN0cmluZyhlKS50b0xvd2VyQ2FzZSgpKTtcclxuICAgIGNvbnN0IGZpbHRlcmVkQ29scyA9IHJlc29sdmVkQ29scy5maWx0ZXIoYyA9PiB7XHJcbiAgICAgIGNvbnN0IGYgPSAoYy5maWVsZCB8fCAnJykudG9TdHJpbmcoKS50b0xvd2VyQ2FzZSgpO1xyXG4gICAgICBjb25zdCBoID0gKGMuaGVhZGVyIHx8ICcnKS50b1N0cmluZygpLnRvTG93ZXJDYXNlKCk7XHJcbiAgICAgIHJldHVybiAhKGV4Y2x1ZGVzLmluY2x1ZGVzKGYpIHx8IGV4Y2x1ZGVzLmluY2x1ZGVzKGgpKTtcclxuICAgIH0pO1xyXG4gICAgY29uc3QgZmluYWxDb2xzID0gZmlsdGVyZWRDb2xzLmxlbmd0aCA+IDAgPyBmaWx0ZXJlZENvbHMgOiByZXNvbHZlZENvbHM7XHJcblxyXG4gICAgY29uc3QgaGVhZGVyUm93ID0gZmluYWxDb2xzLm1hcChjID0+IGMuaGVhZGVyKTtcclxuICAgIGNvbnN0IGRhdGFSb3dzID0gcm93cy5tYXAociA9PiBmaW5hbENvbHMubWFwKGMgPT4gdGhpcy5zYW5pdGl6ZUNlbGwocj8uW2MuZmllbGRdKSkpO1xyXG4gICAgY29uc3QgYW9hID0gW2hlYWRlclJvdywgLi4uZGF0YVJvd3NdO1xyXG4gICAgY29uc3QgY2xlYW4gPSB0aGlzLnNhbml0aXplQW9hKGFvYSk7XHJcbiAgICB0aGlzLmV4Y2VsRGF0YSA9IChjbGVhbiAmJiBjbGVhbi5sZW5ndGgpID8gY2xlYW4gOiBbWycnXV07XHJcbiAgICB0aGlzLndvcmtib29rID0gdW5kZWZpbmVkO1xyXG4gICAgdGhpcy5zaGVldE5hbWVzID0gW25hbWVdO1xyXG4gICAgdGhpcy5zZWxlY3RlZFNoZWV0ID0gbmFtZTtcclxuICB9XHJcblxyXG4gIG9uRmlsZUNoYW5nZShldmVudDogRXZlbnQpOiB2b2lkIHtcclxuICAgIGNvbnN0IGZpbGUgPSAoZXZlbnQudGFyZ2V0IGFzIEhUTUxJbnB1dEVsZW1lbnQpLmZpbGVzPy5bMF07XHJcbiAgICAoZXZlbnQudGFyZ2V0IGFzIEhUTUxJbnB1dEVsZW1lbnQpLnZhbHVlID0gJyc7IFxyXG4gICAgaWYgKCFmaWxlKSByZXR1cm47XHJcblxyXG4gICAgY29uc3QgcmVhZGVyID0gbmV3IEZpbGVSZWFkZXIoKTtcclxuICAgIHJlYWRlci5vbmxvYWQgPSAoZTogYW55KSA9PiB7XHJcbiAgICAgIGNvbnN0IGRhdGEgPSBuZXcgVWludDhBcnJheShlLnRhcmdldC5yZXN1bHQpO1xyXG4gICAgICB0aGlzLndvcmtib29rID0gWExTWC5yZWFkKGRhdGEsIHsgdHlwZTogJ2FycmF5JyB9KTtcclxuXHJcbiAgICAgIHRoaXMuc2hlZXROYW1lcyA9IHRoaXMud29ya2Jvb2suU2hlZXROYW1lcyA/PyBbXTtcclxuICAgICAgdGhpcy5zZWxlY3RlZFNoZWV0ID0gdGhpcy5zaGVldE5hbWVzWzBdID8/ICcnO1xyXG5cclxuICAgICAgaWYgKCF0aGlzLnNlbGVjdGVkU2hlZXQpIHtcclxuICAgICAgICB0aGlzLmV4Y2VsRGF0YSA9IFtdO1xyXG4gICAgICAgIHJldHVybjtcclxuICAgICAgfVxyXG4gICAgICB0aGlzLmxvYWRTaGVldCh0aGlzLnNlbGVjdGVkU2hlZXQpO1xyXG4gICAgfTtcclxuICAgIHJlYWRlci5yZWFkQXNBcnJheUJ1ZmZlcihmaWxlKTtcclxuICB9XHJcblxyXG4gIGxvYWRTaGVldChzaGVldE5hbWU6IHN0cmluZyk6IHZvaWQge1xyXG4gICAgaWYgKCF0aGlzLndvcmtib29rKSByZXR1cm47XHJcbiAgICBjb25zdCB3cyA9IHRoaXMud29ya2Jvb2suU2hlZXRzW3NoZWV0TmFtZV07XHJcbiAgICBjb25zdCBhb2EgPSBYTFNYLnV0aWxzLnNoZWV0X3RvX2pzb248YW55W10+KHdzLCB7IGhlYWRlcjogMSB9KSBhcyBhbnlbXVtdO1xyXG4gICAgY29uc3QgY2xlYW4gPSB0aGlzLnNhbml0aXplQW9hKGFvYSk7XHJcbiAgICBjb25zdCB0cmltbWVkID0gdGhpcy50cmltTGVhZGluZ0VtcHR5Um93cyhjbGVhbik7XHJcbiAgICB0aGlzLmV4Y2VsRGF0YSA9ICh0cmltbWVkICYmIHRyaW1tZWQubGVuZ3RoKSA/IHRyaW1tZWQgOiBbWycnXV07XHJcbiAgfVxyXG5cclxuICBvblNoZWV0Q2hhbmdlKGV2ZW50OiBFdmVudCk6IHZvaWQge1xyXG4gICAgY29uc3Qgc2hlZXQgPSAoZXZlbnQudGFyZ2V0IGFzIEhUTUxTZWxlY3RFbGVtZW50KS52YWx1ZTtcclxuICAgIHRoaXMuc2VsZWN0ZWRTaGVldCA9IHNoZWV0O1xyXG4gICAgdGhpcy5sb2FkU2hlZXQoc2hlZXQpO1xyXG4gIH1cclxuXHJcbiAgZG93bmxvYWRFeGNlbCgpOiB2b2lkIHtcclxuICAgIGNvbnN0IHdiID0gWExTWC51dGlscy5ib29rX25ldygpO1xyXG4gICAgY29uc3Qgd3MgPSBYTFNYLnV0aWxzLmFvYV90b19zaGVldCh0aGlzLmV4Y2VsRGF0YSk7XHJcbiAgICBjb25zdCBuYW1lID0gdGhpcy5zZWxlY3RlZFNoZWV0IHx8IHRoaXMuc2hlZXROYW1lIHx8ICdTaGVldDEnO1xyXG4gICAgWExTWC51dGlscy5ib29rX2FwcGVuZF9zaGVldCh3Yiwgd3MsIG5hbWUpO1xyXG5cclxuICAgIGNvbnN0IGJ1ZiA9IFhMU1gud3JpdGUod2IsIHsgYm9va1R5cGU6ICd4bHN4JywgdHlwZTogJ2FycmF5JyB9KTtcclxuICAgIGNvbnN0IGJsb2IgPSBuZXcgQmxvYihbYnVmXSwgeyB0eXBlOiAnYXBwbGljYXRpb24vb2N0ZXQtc3RyZWFtJyB9KTtcclxuICAgIHNhdmVBcyhibG9iLCAndXBkYXRlZF9leGNlbC54bHN4Jyk7XHJcbiAgfVxyXG59XHJcblxyXG4iLCI8ZGl2IGNsYXNzPVwiY29udGFpbmVyXCI+XHJcbiAgPGRpdiBjbGFzcz1cInVwbG9hZC1zZWN0aW9uXCIgKm5nSWY9XCIhaGlkZVVwbG9hZFwiPlxyXG4gICAgPGxhYmVsIGZvcj1cImZpbGUtdXBsb2FkXCIgY2xhc3M9XCJ1cGxvYWQtYnRuXCI+VXBsb2FkIEV4Y2VsPC9sYWJlbD5cclxuICAgIDxpbnB1dCB0eXBlPVwiZmlsZVwiIGlkPVwiZmlsZS11cGxvYWRcIiBhY2NlcHQ9XCIueGxzeCwueGxzLC5jc3ZcIiAoY2hhbmdlKT1cIm9uRmlsZUNoYW5nZSgkZXZlbnQpXCIgaGlkZGVuIC8+XHJcbiAgICA8YnV0dG9uIGNsYXNzPVwiZG93bmxvYWQtYnRuXCIgKGNsaWNrKT1cImRvd25sb2FkRXhjZWwoKVwiIFtkaXNhYmxlZF09XCIhZXhjZWxEYXRhLmxlbmd0aFwiPkRvd25sb2FkIFVwZGF0ZWQgRXhjZWw8L2J1dHRvbj5cclxuICA8L2Rpdj5cclxuXHJcbiAgPGRpdiAqbmdJZj1cInNoZWV0TmFtZXMubGVuZ3RoID4gMVwiIGNsYXNzPVwic2hlZXQtc2VsZWN0b3JcIj5cclxuICAgIDxsYWJlbCBmb3I9XCJzaGVldFNlbGVjdFwiPlNlbGVjdCBTaGVldDo8L2xhYmVsPlxyXG4gICAgPHNlbGVjdCBpZD1cInNoZWV0U2VsZWN0XCIgKGNoYW5nZSk9XCJvblNoZWV0Q2hhbmdlKCRldmVudClcIiBbdmFsdWVdPVwic2VsZWN0ZWRTaGVldFwiPlxyXG4gICAgICA8b3B0aW9uICpuZ0Zvcj1cImxldCBzaGVldCBvZiBzaGVldE5hbWVzXCIgW3ZhbHVlXT1cInNoZWV0XCI+e3sgc2hlZXQgfX08L29wdGlvbj5cclxuICAgIDwvc2VsZWN0PlxyXG4gIDwvZGl2PlxyXG5cclxuICA8ZGl2ICpuZ0lmPVwiZXhjZWxEYXRhLmxlbmd0aCA+IDBcIiBjbGFzcz1cImV4Y2VsLXdyYXBwZXJcIiBbbmdTdHlsZV09XCJ7IHdpZHRoOiBjb250YWluZXJXaWR0aCB9XCI+XHJcbiAgICA8ZGl2IGNsYXNzPVwiZXhjZWwtdG9vbGJhclwiPlxyXG4gICAgICA8YnV0dG9uIHR5cGU9XCJidXR0b25cIiBjbGFzcz1cInRsYi1idG5cIiB0aXRsZT1cIkJvbGRcIiAoY2xpY2spPVwidG9nZ2xlQm9sZCgpXCI+PHN0cm9uZz5CPC9zdHJvbmc+PC9idXR0b24+XHJcbiAgICAgIDxkaXYgY2xhc3M9XCJ0bGItc2VwXCI+PC9kaXY+XHJcbiAgICAgIDxidXR0b24gdHlwZT1cImJ1dHRvblwiIGNsYXNzPVwidGxiLWJ0blwiIHRpdGxlPVwiQWxpZ24gbGVmdFwiIChjbGljayk9XCJhbGlnbignbGVmdCcpXCI+TDwvYnV0dG9uPlxyXG4gICAgICA8YnV0dG9uIHR5cGU9XCJidXR0b25cIiBjbGFzcz1cInRsYi1idG5cIiB0aXRsZT1cIkFsaWduIGNlbnRlclwiIChjbGljayk9XCJhbGlnbignY2VudGVyJylcIj5DPC9idXR0b24+XHJcbiAgICAgIDxidXR0b24gdHlwZT1cImJ1dHRvblwiIGNsYXNzPVwidGxiLWJ0blwiIHRpdGxlPVwiQWxpZ24gcmlnaHRcIiAoY2xpY2spPVwiYWxpZ24oJ3JpZ2h0JylcIj5SPC9idXR0b24+XHJcbiAgICAgIDxkaXYgY2xhc3M9XCJ0bGItc2VwXCI+PC9kaXY+XHJcbiAgICAgIDxidXR0b24gdHlwZT1cImJ1dHRvblwiIGNsYXNzPVwidGxiLWJ0blwiIHRpdGxlPVwiV3JhcCB0ZXh0XCIgKGNsaWNrKT1cInRvZ2dsZVdyYXAoKVwiPldyYXA8L2J1dHRvbj5cclxuICAgICAgPGRpdiBjbGFzcz1cInRsYi1zZXBcIj48L2Rpdj5cclxuICAgICAgPGJ1dHRvbiB0eXBlPVwiYnV0dG9uXCIgY2xhc3M9XCJ0bGItYnRuXCIgdGl0bGU9XCJBdXRvU3VtIChBbHQrPSlcIiAoY2xpY2spPVwiYWRkU3VtT3ZlclNlbGVjdGlvbigpXCI+U3VtPC9idXR0b24+XHJcbiAgICAgIDxidXR0b24gdHlwZT1cImJ1dHRvblwiIGNsYXNzPVwidGxiLWJ0blwiIHRpdGxlPVwiQXZlcmFnZVwiIChjbGljayk9XCJhZGRBdmdPdmVyU2VsZWN0aW9uKClcIj5Bdmc8L2J1dHRvbj5cclxuICAgICAgPGJ1dHRvbiB0eXBlPVwiYnV0dG9uXCIgY2xhc3M9XCJ0bGItYnRuXCIgdGl0bGU9XCJDb3VudFwiIChjbGljayk9XCJhZGRDb3VudE92ZXJTZWxlY3Rpb24oKVwiPkNudDwvYnV0dG9uPlxyXG4gICAgICA8ZGl2IGNsYXNzPVwidGxiLWdyb3dcIj48L2Rpdj5cclxuICAgICAgPGlucHV0IGNsYXNzPVwibmFtZS1ib3hcIiBbdmFsdWVdPVwibmFtZUJveFwiIHJlYWRvbmx5IGFyaWEtbGFiZWw9XCJDZWxsIGFkZHJlc3NcIiAvPlxuICAgICAgPGlucHV0IGNsYXNzPVwiZm9ybXVsYS1pbnB1dFwiIFsobmdNb2RlbCldPVwiZm9ybXVsYVRleHRcIiAoa2V5dXAuZW50ZXIpPVwiYXBwbHlGb3JtdWxhQmFyKClcIiAoYmx1cik9XCJhcHBseUZvcm11bGFCYXIoKVwiIHBsYWNlaG9sZGVyPVwiZnhcIiBhcmlhLWxhYmVsPVwiRm9ybXVsYSBiYXJcIiAvPlxuICAgICAgPGJ1dHRvbiB0eXBlPVwiYnV0dG9uXCIgY2xhc3M9XCJ0bGItYnRuXCIgdGl0bGU9XCJGaW5kIChDdHJsK0YpXCIgKGNsaWNrKT1cIm9wZW5GaW5kUGFuZWwoKVwiPkZpbmQ8L2J1dHRvbj5cbiAgICAgIDxkaXYgY2xhc3M9XCJmaW5kLXBhbmVsXCIgKm5nSWY9XCJzaG93RmluZFwiPlxuICAgICAgICA8aW5wdXQgI2ZpbmRJbnB1dCBjbGFzcz1cImZpbmQtaW5wdXRcIiBbKG5nTW9kZWwpXT1cImZpbmRRdWVyeVwiIChpbnB1dCk9XCJydW5GaW5kKClcIiAoa2V5dXAuZW50ZXIpPVwibmV4dEZpbmQoKVwiIHBsYWNlaG9sZGVyPVwiRmluZC4uLlwiIC8+XG4gICAgICAgIDxpbnB1dCBjbGFzcz1cInJlcGxhY2UtaW5wdXRcIiBbKG5nTW9kZWwpXT1cInJlcGxhY2VUZXh0XCIgcGxhY2Vob2xkZXI9XCJSZXBsYWNlIHdpdGguLi5cIiAvPlxuICAgICAgICA8bGFiZWwgY2xhc3M9XCJmaW5kLW9wdFwiPjxpbnB1dCB0eXBlPVwiY2hlY2tib3hcIiBbKG5nTW9kZWwpXT1cImZpbmRDYXNlU2Vuc2l0aXZlXCIgKGNoYW5nZSk9XCJydW5GaW5kKClcIiAvPiBDYXNlPC9sYWJlbD5cbiAgICAgICAgPHNwYW4gY2xhc3M9XCJmaW5kLWNvdW50XCI+e3sgZmluZFJlc3VsdHMubGVuZ3RoID8gKGN1cnJlbnRGaW5kSW5kZXggKyAxKSArICcvJyArIGZpbmRSZXN1bHRzLmxlbmd0aCA6ICcwLzAnIH19PC9zcGFuPlxuICAgICAgICA8YnV0dG9uIHR5cGU9XCJidXR0b25cIiBjbGFzcz1cInRsYi1idG5cIiAoY2xpY2spPVwicHJldkZpbmQoKVwiPlByZXY8L2J1dHRvbj5cbiAgICAgICAgPGJ1dHRvbiB0eXBlPVwiYnV0dG9uXCIgY2xhc3M9XCJ0bGItYnRuXCIgKGNsaWNrKT1cIm5leHRGaW5kKClcIj5OZXh0PC9idXR0b24+XG4gICAgICAgIDxidXR0b24gdHlwZT1cImJ1dHRvblwiIGNsYXNzPVwidGxiLWJ0blwiIChjbGljayk9XCJyZXBsYWNlQ3VycmVudCgpXCIgW2Rpc2FibGVkXT1cIiFmaW5kUXVlcnlcIj5SZXBsYWNlPC9idXR0b24+XG4gICAgICAgIDxidXR0b24gdHlwZT1cImJ1dHRvblwiIGNsYXNzPVwidGxiLWJ0blwiIChjbGljayk9XCJyZXBsYWNlQWxsTWF0Y2hlcygpXCIgW2Rpc2FibGVkXT1cIiFmaW5kUXVlcnlcIj5SZXBsYWNlIEFsbDwvYnV0dG9uPlxuICAgICAgICA8YnV0dG9uIHR5cGU9XCJidXR0b25cIiBjbGFzcz1cInRsYi1idG5cIiAoY2xpY2spPVwiY2xvc2VGaW5kUGFuZWwoKVwiPkNsb3NlPC9idXR0b24+XG4gICAgICA8L2Rpdj5cbiAgICA8L2Rpdj5cbiAgICA8ZGl2IGNsYXNzPVwidGFibGUtY29udGFpbmVyXCIgW25nU3R5bGVdPVwieyBoZWlnaHQ6IGNvbnRhaW5lckhlaWdodCB9XCI+XG4gICAgICA8aG90LXRhYmxlICNob3RSZWYgW2hvdElkXT1cImhvdElkXCIgY2xhc3M9XCJob3QtZnVsbFwiXG4gICAgICAgIFtkYXRhXT1cImV4Y2VsRGF0YVwiIFtyb3dIZWFkZXJzXT1cInRydWVcIiBbY29sSGVhZGVyc109XCJ0cnVlXCJcbiAgICAgICAgW2Ryb3Bkb3duTWVudV09XCJ0cnVlXCIgW2ZpbHRlcnNdPVwidHJ1ZVwiIFtzZWFyY2hdPVwidHJ1ZVwiXG4gICAgICAgIFtjb250ZXh0TWVudV09XCJjb250ZXh0TWVudVwiIFtmb3JtdWxhc109XCJmb3JtdWxhc1wiIFtsaWNlbnNlS2V5XT1cImxpY2Vuc2VLZXlcIlxyXG4gICAgICAgIFtjb3B5UGFzdGVdPVwiZmFsc2VcIlxyXG4gICAgICAgIFtzdHJldGNoSF09XCInYWxsJ1wiIFttYW51YWxDb2x1bW5SZXNpemVdPVwidHJ1ZVwiIFttYW51YWxSb3dSZXNpemVdPVwidHJ1ZVwiXHJcbiAgICAgICAgW21hbnVhbENvbHVtbk1vdmVdPVwidHJ1ZVwiIFttYW51YWxSb3dNb3ZlXT1cInRydWVcIiBbY29sdW1uU29ydGluZ109XCJ0cnVlXCJcclxuICAgICAgICBbZmlsbEhhbmRsZV09XCJ0cnVlXCIgW2ZpeGVkUm93c1RvcF09XCJoZWFkZXJSb3dzXCIgW2ZpeGVkQ29sdW1uc0xlZnRdPVwiMFwiXHJcbiAgICAgICAgW291dHNpZGVDbGlja0Rlc2VsZWN0c109XCJmYWxzZVwiIFtjdXJyZW50Um93Q2xhc3NOYW1lXT1cIidjdXJyZW50Um93J1wiXHJcbiAgICAgICAgW2N1cnJlbnRDb2xDbGFzc05hbWVdPVwiJ2N1cnJlbnRDb2wnXCI+XG4gICAgICA8L2hvdC10YWJsZT5cbiAgICA8L2Rpdj5cbiAgICA8ZGl2IGNsYXNzPVwic3RhdHVzLWJhclwiIGFyaWEtbGl2ZT1cInBvbGl0ZVwiPlxuICAgICAgPG5nLWNvbnRhaW5lciAqbmdJZj1cIiFzZWxlY3Rpb25TdGF0cy5oYXNOb25OdW1lcmljICYmIHNlbGVjdGlvblN0YXRzLm51bWVyaWNDb3VudCA+IDA7IGVsc2UgY291bnRPbmx5XCI+XG4gICAgICAgIDxkaXYgY2xhc3M9XCJzdGF0dXMtaXRlbVwiPlxuICAgICAgICAgIDxzcGFuIGNsYXNzPVwic3RhdHVzLWxhYmVsXCI+QXZlcmFnZTwvc3Bhbj5cbiAgICAgICAgICA8c3BhbiBjbGFzcz1cInN0YXR1cy12YWx1ZVwiPnt7IHNlbGVjdGlvblN0YXRzLmF2ZXJhZ2UgIT09IG51bGwgPyAoc2VsZWN0aW9uU3RhdHMuYXZlcmFnZSB8IG51bWJlcjonMS4wLTQnKSA6ICfigJQnIH19PC9zcGFuPlxuICAgICAgICA8L2Rpdj5cbiAgICAgICAgPGRpdiBjbGFzcz1cInN0YXR1cy1pdGVtXCI+XG4gICAgICAgICAgPHNwYW4gY2xhc3M9XCJzdGF0dXMtbGFiZWxcIj5Db3VudDwvc3Bhbj5cbiAgICAgICAgICA8c3BhbiBjbGFzcz1cInN0YXR1cy12YWx1ZVwiPnt7IHNlbGVjdGlvblN0YXRzLmNvdW50IH19PC9zcGFuPlxuICAgICAgICA8L2Rpdj5cbiAgICAgICAgPGRpdiBjbGFzcz1cInN0YXR1cy1pdGVtXCI+XG4gICAgICAgICAgPHNwYW4gY2xhc3M9XCJzdGF0dXMtbGFiZWxcIj5TdW08L3NwYW4+XG4gICAgICAgICAgPHNwYW4gY2xhc3M9XCJzdGF0dXMtdmFsdWVcIj57eyBzZWxlY3Rpb25TdGF0cy5udW1lcmljQ291bnQgPyAoc2VsZWN0aW9uU3RhdHMuc3VtIHwgbnVtYmVyOicxLjAtNCcpIDogJ+KAlCcgfX08L3NwYW4+XG4gICAgICAgIDwvZGl2PlxuICAgICAgPC9uZy1jb250YWluZXI+XG4gICAgICA8bmctdGVtcGxhdGUgI2NvdW50T25seT5cbiAgICAgICAgPGRpdiBjbGFzcz1cInN0YXR1cy1pdGVtXCI+XG4gICAgICAgICAgPHNwYW4gY2xhc3M9XCJzdGF0dXMtbGFiZWxcIj5Db3VudDwvc3Bhbj5cbiAgICAgICAgICA8c3BhbiBjbGFzcz1cInN0YXR1cy12YWx1ZVwiPnt7IHNlbGVjdGlvblN0YXRzLmNvdW50IH19PC9zcGFuPlxuICAgICAgICA8L2Rpdj5cbiAgICAgIDwvbmctdGVtcGxhdGU+XG4gICAgPC9kaXY+XG4gIDwvZGl2PlxuPC9kaXY+XG4iXX0=