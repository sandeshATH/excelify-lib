import * as i0 from '@angular/core';
import { ViewChild, Input, Component, NgModule } from '@angular/core';
import * as i1 from '@angular/common';
import { CommonModule } from '@angular/common';
import * as i2 from '@handsontable/angular';
import { HotTableRegisterer, HotTableModule } from '@handsontable/angular';
import { HyperFormula } from 'hyperformula';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';
import * as i3 from '@angular/forms';
import { FormsModule } from '@angular/forms';

class ExcelifyComponent {
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

class ExcelifyModule {
    static ɵfac = i0.ɵɵngDeclareFactory({ minVersion: "12.0.0", version: "18.2.12", ngImport: i0, type: ExcelifyModule, deps: [], target: i0.ɵɵFactoryTarget.NgModule });
    static ɵmod = i0.ɵɵngDeclareNgModule({ minVersion: "14.0.0", version: "18.2.12", ngImport: i0, type: ExcelifyModule, imports: [ExcelifyComponent], exports: [ExcelifyComponent] });
    static ɵinj = i0.ɵɵngDeclareInjector({ minVersion: "12.0.0", version: "18.2.12", ngImport: i0, type: ExcelifyModule, imports: [ExcelifyComponent] });
}
i0.ɵɵngDeclareClassMetadata({ minVersion: "12.0.0", version: "18.2.12", ngImport: i0, type: ExcelifyModule, decorators: [{
            type: NgModule,
            args: [{
                    imports: [ExcelifyComponent],
                    exports: [ExcelifyComponent],
                }]
        }] });

/*
 * Public API Surface of excelify
 */

/**
 * Generated bundle index. Do not edit.
 */

export { ExcelifyComponent, ExcelifyModule };
//# sourceMappingURL=devath-excelify.mjs.map
