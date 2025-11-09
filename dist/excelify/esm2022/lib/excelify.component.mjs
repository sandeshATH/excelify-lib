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
        setTimeout(() => this.findInput?.nativeElement?.focus(), 0);
    }
    closeFindPanel() {
        this.showFind = false;
        this.clearFind();
    }
    runFind() {
        if (!this.hot)
            return;
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
            this.gotoFindIndex(0);
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
    gotoFindIndex(idx) {
        if (!this.hot || !this.findResults.length)
            return;
        const n = this.findResults.length;
        this.currentFindIndex = ((idx % n) + n) % n; // wrap
        const { row, col } = this.findResults[this.currentFindIndex];
        this.hot.selectCell(row, col, row, col, true, true);
        this.updateSelection(row, col);
    }
    nextFind() { this.gotoFindIndex(this.currentFindIndex + 1); }
    prevFind() { this.gotoFindIndex(this.currentFindIndex - 1); }
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZXhjZWxpZnkuY29tcG9uZW50LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vcHJvamVjdHMvZXhjZWxpZnkvc3JjL2xpYi9leGNlbGlmeS5jb21wb25lbnQudHMiLCIuLi8uLi8uLi8uLi9wcm9qZWN0cy9leGNlbGlmeS9zcmMvbGliL2V4Y2VsaWZ5LmNvbXBvbmVudC5odG1sIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLE9BQU8sRUFBRSxTQUFTLEVBQUUsS0FBSyxFQUE0QixTQUFTLEVBQTZCLE1BQU0sZUFBZSxDQUFDO0FBQ2pILE9BQU8sRUFBRSxZQUFZLEVBQUUsTUFBTSxpQkFBaUIsQ0FBQztBQUMvQyxPQUFPLEVBQUUsY0FBYyxFQUFxQixrQkFBa0IsRUFBRSxNQUFNLHVCQUF1QixDQUFDO0FBRTlGLE9BQU8sRUFBRSxZQUFZLEVBQUUsTUFBTSxjQUFjLENBQUM7QUFDNUMsT0FBTyxLQUFLLElBQUksTUFBTSxNQUFNLENBQUM7QUFDN0IsT0FBTyxFQUFFLE1BQU0sRUFBRSxNQUFNLFlBQVksQ0FBQztBQUNwQyxPQUFPLEVBQUUsV0FBVyxFQUFFLE1BQU0sZ0JBQWdCLENBQUM7Ozs7O0FBUzdDLE1BQU0sT0FBTyxpQkFBaUI7SUFDNUIsU0FBUyxHQUFZLEVBQUUsQ0FBQztJQUVmLFFBQVEsQ0FBTTtJQUVmLFFBQVEsQ0FBaUI7SUFDakMsVUFBVSxHQUFhLEVBQUUsQ0FBQztJQUMxQixhQUFhLEdBQUcsRUFBRSxDQUFDO0lBRW5CLHVEQUF1RDtJQUMvQyxFQUFFLEdBQUcsWUFBWSxDQUFDLFVBQVUsQ0FBQyxFQUFFLFVBQVUsRUFBRSxRQUFRLEVBQUUsQ0FBQyxDQUFDO0lBQy9ELFFBQVEsR0FBUSxFQUFFLE1BQU0sRUFBRSxJQUFJLENBQUMsRUFBRSxFQUFFLENBQUM7SUFDdEMsYUFBYTtJQUNYLGtEQUFrRDtJQUNsRCxXQUFXLEdBQXlEO1FBQ2xFLFdBQVc7UUFDWCxXQUFXO1FBQ1gsVUFBVTtRQUNWLFdBQVc7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RHBFWSxZQUFZLDRZQUFFLGNBQWMsd3JOQUFFLFdBQVc7OzRGQUl4QyxpQkFBaUI7a0JBUDdCLFNBQVM7K0JBQ0UsYUFBYSxjQUNYLElBQUksV0FDUCxDQUFDLFlBQVksRUFBRSxjQUFjLEVBQUUsV0FBVyxDQUFDOzhCQU8zQyxRQUFRO3NCQUFoQixLQUFLO2dCQTZCRyxJQUFJO3NCQUFaLEtBQUs7Z0JBQ0csT0FBTztzQkFBZixLQUFLO2dCQUNHLFNBQVM7c0JBQWpCLEtBQUs7Z0JBQ0csVUFBVTtzQkFBbEIsS0FBSztnQkFFRyxjQUFjO3NCQUF0QixLQUFLO2dCQUVHLGVBQWU7c0JBQXZCLEtBQUs7Z0JBQ0csY0FBYztzQkFBdEIsS0FBSztnQkFFRyxVQUFVO3NCQUFsQixLQUFLO2dCQUVrQyxZQUFZO3NCQUFuRCxTQUFTO3VCQUFDLFFBQVEsRUFBRSxFQUFFLE1BQU0sRUFBRSxLQUFLLEVBQUU7Z0JBcUJkLFNBQVM7c0JBQWhDLFNBQVM7dUJBQUMsV0FBVyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IENvbXBvbmVudCwgSW5wdXQsIE9uQ2hhbmdlcywgU2ltcGxlQ2hhbmdlcywgVmlld0NoaWxkLCBBZnRlclZpZXdJbml0LCBFbGVtZW50UmVmIH0gZnJvbSAnQGFuZ3VsYXIvY29yZSc7XHJcbmltcG9ydCB7IENvbW1vbk1vZHVsZSB9IGZyb20gJ0Bhbmd1bGFyL2NvbW1vbic7XHJcbmltcG9ydCB7IEhvdFRhYmxlTW9kdWxlLCBIb3RUYWJsZUNvbXBvbmVudCwgSG90VGFibGVSZWdpc3RlcmVyIH0gZnJvbSAnQGhhbmRzb250YWJsZS9hbmd1bGFyJztcclxuaW1wb3J0IEhhbmRzb250YWJsZSBmcm9tICdoYW5kc29udGFibGUnO1xyXG5pbXBvcnQgeyBIeXBlckZvcm11bGEgfSBmcm9tICdoeXBlcmZvcm11bGEnO1xyXG5pbXBvcnQgKiBhcyBYTFNYIGZyb20gJ3hsc3gnO1xyXG5pbXBvcnQgeyBzYXZlQXMgfSBmcm9tICdmaWxlLXNhdmVyJztcclxuaW1wb3J0IHsgRm9ybXNNb2R1bGUgfSBmcm9tICdAYW5ndWxhci9mb3Jtcyc7XHJcblxyXG5AQ29tcG9uZW50KHtcbiAgc2VsZWN0b3I6ICdlcS1leGNlbGlmeScsXG4gIHN0YW5kYWxvbmU6IHRydWUsXG4gIGltcG9ydHM6IFtDb21tb25Nb2R1bGUsIEhvdFRhYmxlTW9kdWxlLCBGb3Jtc01vZHVsZV0sXG4gIHRlbXBsYXRlVXJsOiAnLi9leGNlbGlmeS5jb21wb25lbnQuaHRtbCcsXG4gIHN0eWxlVXJsczogWycuL2V4Y2VsaWZ5LmNvbXBvbmVudC5zY3NzJ10sXG59KVxuZXhwb3J0IGNsYXNzIEV4Y2VsaWZ5Q29tcG9uZW50IGltcGxlbWVudHMgQWZ0ZXJWaWV3SW5pdCB7XG4gIGV4Y2VsRGF0YTogYW55W11bXSA9IFtdO1xyXG5cclxuICBASW5wdXQoKSBncmlkZGF0YTogYW55O1xyXG5cclxuICBwcml2YXRlIHdvcmtib29rPzogWExTWC5Xb3JrQm9vaztcclxuICBzaGVldE5hbWVzOiBzdHJpbmdbXSA9IFtdO1xyXG4gIHNlbGVjdGVkU2hlZXQgPSAnJztcclxuXHJcbiAgLy8gSHlwZXJGb3JtdWxhIGVuZ2luZSBpbnN0YW5jZSAoUkVRVUlSRUQgZm9yIGZvcm11bGFzKVxyXG4gIHByaXZhdGUgaGYgPSBIeXBlckZvcm11bGEuYnVpbGRFbXB0eSh7IGxpY2Vuc2VLZXk6ICdncGwtdjMnIH0pO1xyXG4gIGZvcm11bGFzOiBhbnkgPSB7IGVuZ2luZTogdGhpcy5oZiB9O1xyXG4vLyBAdHMtaWdub3JlXHJcbiAgLy8gU2hvdyBpbnNlcnQvZGVsZXRlIHJvdy9jb2wgZXRjLiBpbiBjb250ZXh0IG1lbnVcclxuICBjb250ZXh0TWVudTogSGFuZHNvbnRhYmxlLmNvbnRleHRNZW51LlNldHRpbmdzWydpdGVtcyddIHwgYm9vbGVhbiA9IFtcclxuICAgICdyb3dfYWJvdmUnLFxyXG4gICAgJ3Jvd19iZWxvdycsXHJcbiAgICAnY29sX2xlZnQnLFxyXG4gICAgJ2NvbF9yaWdodCcsXHJcbiAgICAncmVtb3ZlX3JvdycsXHJcbiAgICAncmVtb3ZlX2NvbCcsXHJcbiAgICAnLS0tLS0tLS0tJyxcclxuICAgICd1bmRvJyxcclxuICAgICdyZWRvJyxcclxuICAgIC8vICdjb3B5JywgIGlmIHlvdSB3YW50IHRvIGVuYWJsZSBhIGNvcHkgY3V0IFxyXG4gICAgLy8gJ2N1dCcsXHJcbiAgICAnYWxpZ25tZW50JyxcclxuICBdO1xyXG5cclxuICAvLyBIYW5kc29udGFibGUgbGljZW5zZSAoZGV2L2V2YWwpXHJcbiAgbGljZW5zZUtleSA9ICdub24tY29tbWVyY2lhbC1hbmQtZXZhbHVhdGlvbic7XHJcblxyXG4gIEBJbnB1dCgpIGRhdGE/OiBhbnlbXTtcclxuICBASW5wdXQoKSBjb2x1bW5zPzogeyBmaWVsZDogc3RyaW5nOyBoZWFkZXI/OiBzdHJpbmcgfVtdO1xyXG4gIEBJbnB1dCgpIHNoZWV0TmFtZT86IHN0cmluZztcclxuICBASW5wdXQoKSBoaWRlVXBsb2FkID0gZmFsc2U7XHJcbiAgLy8gRXhjbHVkZSBjb2x1bW5zIGJ5IGZpZWxkIG9yIGhlYWRlciB0ZXh0IChjYXNlLWluc2Vuc2l0aXZlKVxyXG4gIEBJbnB1dCgpIGV4Y2x1ZGVDb2x1bW5zOiBzdHJpbmdbXSA9IFtdO1xyXG4gIC8vIENvbnN0cmFpbmVkIGNvbnRhaW5lciBzaXplIChjdXN0b21pemFibGUgYnkgcGFyZW50KVxyXG4gIEBJbnB1dCgpIGNvbnRhaW5lckhlaWdodDogc3RyaW5nID0gJzcwdmgnO1xyXG4gIEBJbnB1dCgpIGNvbnRhaW5lcldpZHRoOiBzdHJpbmcgPSAnMTAwJSc7XHJcbiAgLy8gTnVtYmVyIG9mIHRvcCByb3dzIHRvIHRyZWF0IGFzIGhlYWRlcnMgKG5vdCBzb3J0YWJsZSlcclxuICBASW5wdXQoKSBoZWFkZXJSb3dzOiBudW1iZXIgPSAxO1xyXG4gIFxyXG4gIEBWaWV3Q2hpbGQoJ2hvdFJlZicsIHsgc3RhdGljOiBmYWxzZSB9KSBob3RDb21wb25lbnQ/OiBIb3RUYWJsZUNvbXBvbmVudDtcclxuICBwcml2YXRlIGhvdD86IEhhbmRzb250YWJsZTtcclxuICBwcml2YXRlIGhvdFJlZ2lzdGVyZXIgPSBuZXcgSG90VGFibGVSZWdpc3RlcmVyKCk7XHJcbiAgaG90SWQgPSAnZXhjZWxpZnlIb3QnO1xuICBzZWxlY3RlZFJvdyA9IDA7XG4gIHNlbGVjdGVkQ29sID0gMDtcbiAgbmFtZUJveCA9ICdBMSc7XG4gIGZvcm11bGFUZXh0ID0gJyc7XG4gIHNlbGVjdGlvblN0YXRzOiB7IHN1bTogbnVtYmVyOyBhdmVyYWdlOiBudW1iZXIgfCBudWxsOyBudW1lcmljQ291bnQ6IG51bWJlcjsgY291bnQ6IG51bWJlcjsgaGFzTm9uTnVtZXJpYzogYm9vbGVhbiB9ID0ge1xuICAgIHN1bTogMCxcbiAgICBhdmVyYWdlOiBudWxsLFxuICAgIG51bWVyaWNDb3VudDogMCxcbiAgICBjb3VudDogMCxcbiAgICBoYXNOb25OdW1lcmljOiBmYWxzZSxcbiAgfTtcbiAgLy8gRmluZCBwYW5lbCBzdGF0ZVxuICBzaG93RmluZCA9IGZhbHNlO1xuICBmaW5kUXVlcnkgPSAnJztcbiAgZmluZENhc2VTZW5zaXRpdmUgPSBmYWxzZTtcbiAgZmluZFJlc3VsdHM6IHsgcm93OiBudW1iZXI7IGNvbDogbnVtYmVyIH1bXSA9IFtdO1xuICBjdXJyZW50RmluZEluZGV4ID0gMDtcbiAgQFZpZXdDaGlsZCgnZmluZElucHV0JykgZmluZElucHV0PzogRWxlbWVudFJlZjxIVE1MSW5wdXRFbGVtZW50PjtcbiAgcHJpdmF0ZSBsYXN0U2VsZWN0aW9uOiB7IHIxOiBudW1iZXI7IGMxOiBudW1iZXI7IHIyOiBudW1iZXI7IGMyOiBudW1iZXIgfSB8IG51bGwgPSBudWxsO1xuICByZXBsYWNlVGV4dCA9ICcnO1xuXHJcbiAgbmdBZnRlclZpZXdJbml0KCk6IHZvaWQge1xyXG4gICAgdGhpcy5ob3QgPSB0aGlzLmhvdFJlZ2lzdGVyZXIuZ2V0SW5zdGFuY2UodGhpcy5ob3RJZCkgYXMgSGFuZHNvbnRhYmxlIHwgdW5kZWZpbmVkO1xyXG4gICAgaWYgKCF0aGlzLmhvdCkge1xyXG4gICAgICB0aGlzLmhvdCA9ICh0aGlzLmhvdENvbXBvbmVudCBhcyBhbnkpPy5ob3RJbnN0YW5jZSBhcyBIYW5kc29udGFibGUgfCB1bmRlZmluZWQ7XHJcbiAgICB9XHJcbiAgICBpZiAodGhpcy5ob3QpIHtcclxuICAgICAgdGhpcy5ob3QuYWRkSG9vaygnYWZ0ZXJTZWxlY3Rpb24nLCAocjogbnVtYmVyLCBjOiBudW1iZXIsIHIyPzogbnVtYmVyLCBjMj86IG51bWJlcikgPT4ge1xuICAgICAgICB0aGlzLmhhbmRsZVNlbGVjdGlvbkNoYW5nZShyLCBjLCByMiwgYzIpO1xuICAgICAgfSk7XG4gICAgICB0aGlzLmhvdC5hZGRIb29rKCdhZnRlclNlbGVjdGlvbkVuZCcsIChyOiBudW1iZXIsIGM6IG51bWJlciwgcjI/OiBudW1iZXIsIGMyPzogbnVtYmVyKSA9PiB7XG4gICAgICAgIHRoaXMuaGFuZGxlU2VsZWN0aW9uQ2hhbmdlKHIsIGMsIHIyLCBjMik7XG4gICAgICB9KTtcbiAgICAgIHRoaXMuaG90LmFkZEhvb2soJ2FmdGVyT25DZWxsTW91c2VEb3duJywgKCkgPT4gdGhpcy5zeW5jU2VsZWN0aW9uRnJvbUxhc3RSYW5nZSgpKTtcbiAgICAgIHRoaXMuaG90LmFkZEhvb2soJ2FmdGVyT25DZWxsTW91c2VVcCcsICgpID0+IHRoaXMuc3luY1NlbGVjdGlvbkZyb21MYXN0UmFuZ2UoKSk7XG4gICAgICB0aGlzLmhvdC5hZGRIb29rKCdhZnRlckNoYW5nZScsICgpID0+IHtcbiAgICAgICAgdGhpcy51cGRhdGVTZWxlY3Rpb24odGhpcy5zZWxlY3RlZFJvdywgdGhpcy5zZWxlY3RlZENvbCk7XG4gICAgICB9KTtcbiAgICAgIC8vIEFsdCs9IGF1dG9zdW0gc2hvcnRjdXQsIEN0cmwvQ21kK0Ygb3BlbiBGaW5kLCBFc2MgY2xvc2UgRmluZFxyXG4gICAgICB0aGlzLmhvdC5hZGRIb29rKCdiZWZvcmVLZXlEb3duJywgKGU6IEtleWJvYXJkRXZlbnQpID0+IHtcclxuICAgICAgICBpZiAoIWUpIHJldHVybjtcclxuICAgICAgICBjb25zdCBrZXkgPSAoZSBhcyBhbnkpLmtleSBhcyBzdHJpbmc7XHJcbiAgICAgICAgY29uc3QgY29kZSA9IChlIGFzIGFueSkuY29kZSBhcyBzdHJpbmc7XHJcbiAgICAgICAgLy8gQmxvY2sgY29weS9jdXQgc2hvcnRjdXRzIGluc2lkZSB0aGUgZ3JpZFxyXG4gICAgICAgIGNvbnN0IGlzQ3RybExpa2UgPSAoZSBhcyBhbnkpLmN0cmxLZXkgfHwgKGUgYXMgYW55KS5tZXRhS2V5O1xyXG4gICAgICAgIGNvbnN0IGsgPSAoa2V5IHx8ICcnKS50b0xvd2VyQ2FzZSgpO1xyXG4gICAgICAgIGlmIChpc0N0cmxMaWtlICYmIChrID09PSAnYycgfHwgY29kZSA9PT0gJ0tleUMnIHx8IGtleSA9PT0gJ0luc2VydCcpKSB7XHJcbiAgICAgICAgICBlLnByZXZlbnREZWZhdWx0KCk7XHJcbiAgICAgICAgICBlLnN0b3BQcm9wYWdhdGlvbigpO1xyXG4gICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgIH1cclxuICAgICAgICBpZiAoaXNDdHJsTGlrZSAmJiAoayA9PT0gJ3gnIHx8IGNvZGUgPT09ICdLZXlYJykpIHtcclxuICAgICAgICAgIGUucHJldmVudERlZmF1bHQoKTtcclxuICAgICAgICAgIGUuc3RvcFByb3BhZ2F0aW9uKCk7XHJcbiAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGlmICgoZSBhcyBhbnkpLmFsdEtleSAmJiAoa2V5ID09PSAnPScgfHwgY29kZSA9PT0gJ0VxdWFsJykpIHtcclxuICAgICAgICAgIGUucHJldmVudERlZmF1bHQoKTtcclxuICAgICAgICAgIHRoaXMuYWRkU3VtT3ZlclNlbGVjdGlvbigpO1xyXG4gICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgIH1cclxuICAgICAgICBpZiAoKChlIGFzIGFueSkuY3RybEtleSB8fCAoZSBhcyBhbnkpLm1ldGFLZXkpICYmIChrZXk/LnRvTG93ZXJDYXNlKCkgPT09ICdmJykpIHtcclxuICAgICAgICAgIGUucHJldmVudERlZmF1bHQoKTtcclxuICAgICAgICAgIHRoaXMub3BlbkZpbmRQYW5lbCgpO1xyXG4gICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgIH1cclxuICAgICAgICBpZiAoa2V5ID09PSAnRXNjYXBlJyAmJiB0aGlzLnNob3dGaW5kKSB7XHJcbiAgICAgICAgICBlLnByZXZlbnREZWZhdWx0KCk7XHJcbiAgICAgICAgICB0aGlzLmNsb3NlRmluZFBhbmVsKCk7XHJcbiAgICAgICAgfVxyXG4gICAgICB9KTtcclxuXHJcbiAgICAgIC8vIEJsb2NrIHByb2dyYW1tYXRpYyBjb3B5L2N1dCBmcm9tIEhhbmRzb250YWJsZSBjbGlwYm9hcmQgcGlwZWxpbmVcclxuICAgICAgdGhpcy5ob3QuYWRkSG9vaygnYmVmb3JlQ29weScsICgpID0+IGZhbHNlKTtcclxuICAgICAgdGhpcy5ob3QuYWRkSG9vaygnYmVmb3JlQ3V0JywgKCkgPT4gZmFsc2UpO1xyXG5cclxuICAgICAgLy8gU29ydCBvbmx5IGRhdGEgcm93cywga2VlcCB0aGUgZmlyc3QgYGhlYWRlclJvd3NgIGF0IHRoZSB0b3BcclxuICAgICAgdGhpcy5ob3QuYWRkSG9vaygnYmVmb3JlQ29sdW1uU29ydCcsIChfY3VycmVudENmZzogYW55LCBkZXN0aW5hdGlvbkNmZzogYW55KSA9PiB7XHJcbiAgICAgICAgY29uc3QgY2ZnID0gQXJyYXkuaXNBcnJheShkZXN0aW5hdGlvbkNmZykgPyBkZXN0aW5hdGlvbkNmZ1swXSA6IGRlc3RpbmF0aW9uQ2ZnO1xyXG4gICAgICAgIGlmICghY2ZnIHx8IGNmZy5jb2x1bW4gPT0gbnVsbCkgcmV0dXJuOyAvLyBhbGxvdyBkZWZhdWx0IGlmIHVua25vd25cclxuICAgICAgICBjb25zdCBjb2xJbmRleCA9IHR5cGVvZiBjZmcuY29sdW1uID09PSAnbnVtYmVyJyA/IGNmZy5jb2x1bW4gOiAoY2ZnLmNvbHVtbj8udmlzdWFsSW5kZXggPz8gY2ZnLmNvbHVtbik7XHJcbiAgICAgICAgY29uc3Qgb3JkZXI6ICdhc2MnIHwgJ2Rlc2MnID0gKGNmZy5zb3J0T3JkZXIgPT09ICdkZXNjJykgPyAnZGVzYycgOiAnYXNjJztcclxuICAgICAgICB0cnkge1xyXG4gICAgICAgICAgdGhpcy5zb3J0RGF0YVByZXNlcnZpbmdIZWFkZXIoY29sSW5kZXgsIG9yZGVyKTtcclxuICAgICAgICB9IGNhdGNoIChlKSB7XHJcbiAgICAgICAgICBjb25zb2xlLndhcm4oJ0N1c3RvbSBzb3J0IGZhaWxlZCwgZmFsbGluZyBiYWNrIHRvIGRlZmF1bHQnLCBlKTtcclxuICAgICAgICAgIHJldHVybjsgLy8gZGVmYXVsdCB3aWxsIHByb2NlZWRcclxuICAgICAgICB9XHJcbiAgICAgICAgcmV0dXJuIGZhbHNlOyAvLyBjYW5jZWwgZGVmYXVsdCBzb3J0aW5nIHNpbmNlIHdlIGFwcGxpZWQgb3VyIG93blxyXG4gICAgICB9KTtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIC8vIFNvcnRzIHJvd3MgYmVsb3cgYGhlYWRlclJvd3NgIGJ5IHRoZSBnaXZlbiBjb2x1bW4sIGtlZXBpbmcgaGVhZGVyIHJvd3MgdW5jaGFuZ2VkXHJcbiAgcHJpdmF0ZSBzb3J0RGF0YVByZXNlcnZpbmdIZWFkZXIoY29sSW5kZXg6IG51bWJlciwgb3JkZXI6ICdhc2MnIHwgJ2Rlc2MnKSB7XHJcbiAgICBjb25zdCBkYXRhID0gdGhpcy5leGNlbERhdGEgfHwgW107XHJcbiAgICBjb25zdCBoZWFkZXJDb3VudCA9IE1hdGgubWF4KDAsIE1hdGgubWluKHRoaXMuaGVhZGVyUm93cywgZGF0YS5sZW5ndGgpKTtcclxuICAgIGlmIChkYXRhLmxlbmd0aCA8PSBoZWFkZXJDb3VudCkgcmV0dXJuO1xyXG4gICAgY29uc3QgaGVhZCA9IGRhdGEuc2xpY2UoMCwgaGVhZGVyQ291bnQpO1xyXG4gICAgY29uc3QgYm9keSA9IGRhdGEuc2xpY2UoaGVhZGVyQ291bnQpO1xyXG4gICAgY29uc3QgY29sbGF0b3IgPSBuZXcgSW50bC5Db2xsYXRvcih1bmRlZmluZWQsIHsgbnVtZXJpYzogdHJ1ZSwgc2Vuc2l0aXZpdHk6ICdiYXNlJyB9KTtcclxuICAgIGNvbnN0IGNtcCA9IChhOiBhbnksIGI6IGFueSkgPT4ge1xyXG4gICAgICBjb25zdCB2YSA9IGE/Lltjb2xJbmRleF07XHJcbiAgICAgIGNvbnN0IHZiID0gYj8uW2NvbEluZGV4XTtcclxuICAgICAgaWYgKHZhID09IG51bGwgJiYgdmIgPT0gbnVsbCkgcmV0dXJuIDA7XHJcbiAgICAgIGlmICh2YSA9PSBudWxsKSByZXR1cm4gMTsgLy8gbnVsbHMgbGFzdFxyXG4gICAgICBpZiAodmIgPT0gbnVsbCkgcmV0dXJuIC0xO1xyXG4gICAgICBjb25zdCBuYSA9IHR5cGVvZiB2YSA9PT0gJ251bWJlcicgPyB2YSA6IE51bWJlcih2YSk7XHJcbiAgICAgIGNvbnN0IG5iID0gdHlwZW9mIHZiID09PSAnbnVtYmVyJyA/IHZiIDogTnVtYmVyKHZiKTtcclxuICAgICAgbGV0IHJlczogbnVtYmVyO1xyXG4gICAgICBpZiAoIU51bWJlci5pc05hTihuYSkgJiYgIU51bWJlci5pc05hTihuYikpIHJlcyA9IG5hIC0gbmI7IGVsc2UgcmVzID0gY29sbGF0b3IuY29tcGFyZShTdHJpbmcodmEpLCBTdHJpbmcodmIpKTtcclxuICAgICAgcmV0dXJuIG9yZGVyID09PSAnYXNjJyA/IHJlcyA6IC1yZXM7XHJcbiAgICB9O1xyXG4gICAgYm9keS5zb3J0KGNtcCk7XHJcbiAgICB0aGlzLmV4Y2VsRGF0YSA9IFsuLi5oZWFkLCAuLi5ib2R5XTtcclxuICAgIC8vIEVuc3VyZSBIYW5kc29udGFibGUgcmUtcmVuZGVycyB3aXRoIHVwZGF0ZWQgZGF0YVxyXG4gICAgc2V0VGltZW91dCgoKSA9PiB0aGlzLmhvdD8ucmVuZGVyKCkpO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBjb2xUb0xldHRlcihjb2w6IG51bWJlcik6IHN0cmluZyB7XHJcbiAgICBsZXQgcyA9ICcnO1xyXG4gICAgbGV0IG4gPSBjb2wgKyAxO1xyXG4gICAgd2hpbGUgKG4gPiAwKSB7XHJcbiAgICAgIGNvbnN0IG1vZCA9IChuIC0gMSkgJSAyNjtcclxuICAgICAgcyA9IFN0cmluZy5mcm9tQ2hhckNvZGUoNjUgKyBtb2QpICsgcztcclxuICAgICAgbiA9IE1hdGguZmxvb3IoKG4gLSBtb2QpIC8gMjYpO1xyXG4gICAgfVxyXG4gICAgcmV0dXJuIHM7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGhhbmRsZVNlbGVjdGlvbkNoYW5nZShyMTogbnVtYmVyLCBjMTogbnVtYmVyLCByMj86IG51bWJlciwgYzI/OiBudW1iZXIpIHtcbiAgICBjb25zdCBlbmRSb3cgPSByMiA/PyByMTtcbiAgICBjb25zdCBlbmRDb2wgPSBjMiA/PyBjMTtcbiAgICB0aGlzLmxhc3RTZWxlY3Rpb24gPSB7XG4gICAgICByMTogTWF0aC5taW4ocjEsIGVuZFJvdyksXG4gICAgICBjMTogTWF0aC5taW4oYzEsIGVuZENvbCksXG4gICAgICByMjogTWF0aC5tYXgocjEsIGVuZFJvdyksXG4gICAgICBjMjogTWF0aC5tYXgoYzEsIGVuZENvbCksXG4gICAgfTtcbiAgICB0aGlzLnVwZGF0ZVNlbGVjdGlvbihyMSwgYzEpO1xuICB9XG5cbiAgcHJpdmF0ZSB1cGRhdGVTZWxlY3Rpb24ocm93OiBudW1iZXIsIGNvbDogbnVtYmVyKSB7XG4gICAgdGhpcy5zZWxlY3RlZFJvdyA9IHJvdztcbiAgICB0aGlzLnNlbGVjdGVkQ29sID0gY29sO1xuICAgIHRoaXMubmFtZUJveCA9IGAke3RoaXMuY29sVG9MZXR0ZXIoY29sKX0ke3JvdyArIDF9YDtcbiAgICBjb25zdCBzcmMgPSB0aGlzLmhvdD8uZ2V0U291cmNlRGF0YUF0Q2VsbChyb3csIGNvbCkgYXMgYW55O1xuICAgIHRoaXMuZm9ybXVsYVRleHQgPSBzcmMgPT0gbnVsbCA/ICcnIDogU3RyaW5nKHNyYyk7XG4gICAgdGhpcy5yZWNhbGN1bGF0ZVNlbGVjdGlvblN0YXRzKCk7XG4gIH1cblxuICBwcml2YXRlIHN5bmNTZWxlY3Rpb25Gcm9tTGFzdFJhbmdlKCkge1xuICAgIGlmICghdGhpcy5ob3QpIHJldHVybjtcbiAgICAvLyBAdHMtaWdub3JlIC0gZGVwZW5kaW5nIG9uIEhPVCB2ZXJzaW9uIHRoaXMgbWF5IG5vdCBiZSB0eXBlZFxuICAgIGNvbnN0IHJhbmdlID0gdGhpcy5ob3QuZ2V0U2VsZWN0ZWRSYW5nZUxhc3Q/LigpO1xuICAgIGlmICghcmFuZ2UpIHJldHVybjtcbiAgICB0aGlzLmhhbmRsZVNlbGVjdGlvbkNoYW5nZShyYW5nZS5mcm9tLnJvdywgcmFuZ2UuZnJvbS5jb2wsIHJhbmdlLnRvLnJvdywgcmFuZ2UudG8uY29sKTtcbiAgfVxuXG4gIHByaXZhdGUgcmVjYWxjdWxhdGVTZWxlY3Rpb25TdGF0cygpIHtcbiAgICBpZiAoIXRoaXMuaG90KSB7XG4gICAgICB0aGlzLnNlbGVjdGlvblN0YXRzID0geyBzdW06IDAsIGF2ZXJhZ2U6IG51bGwsIG51bWVyaWNDb3VudDogMCwgY291bnQ6IDAsIGhhc05vbk51bWVyaWM6IGZhbHNlIH07XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGxldCBzdW0gPSAwO1xuICAgIGxldCBudW1lcmljQ291bnQgPSAwO1xuICAgIGxldCBwb3B1bGF0ZWRDb3VudCA9IDA7XG4gICAgbGV0IGhhc05vbk51bWVyaWMgPSBmYWxzZTtcbiAgICB0aGlzLmZvckVhY2hDZWxsSW5TZWxlY3Rpb24oKHIsIGMpID0+IHtcbiAgICAgIGlmIChyID09IG51bGwgfHwgYyA9PSBudWxsKSByZXR1cm47XG4gICAgICBjb25zdCB2YWwgPSB0aGlzLmhvdCEuZ2V0RGF0YUF0Q2VsbChyLCBjKTtcbiAgICAgIGlmICghdGhpcy5pc1ZhbHVlRW1wdHkodmFsKSkgcG9wdWxhdGVkQ291bnQrKztcbiAgICAgIGNvbnN0IG51bWVyaWMgPSB0aGlzLmNvZXJjZVRvTnVtYmVyKHZhbCk7XG4gICAgICBpZiAobnVtZXJpYyAhPSBudWxsKSB7XG4gICAgICAgIHN1bSArPSBudW1lcmljO1xuICAgICAgICBudW1lcmljQ291bnQrKztcbiAgICAgIH0gZWxzZSBpZiAoIXRoaXMuaXNWYWx1ZUVtcHR5KHZhbCkpIHtcbiAgICAgICAgaGFzTm9uTnVtZXJpYyA9IHRydWU7XG4gICAgICB9XG4gICAgfSk7XG4gICAgdGhpcy5zZWxlY3Rpb25TdGF0cyA9IHtcbiAgICAgIHN1bTogaGFzTm9uTnVtZXJpYyA/IDAgOiAobnVtZXJpY0NvdW50ID8gc3VtIDogMCksXG4gICAgICBhdmVyYWdlOiAhaGFzTm9uTnVtZXJpYyAmJiBudW1lcmljQ291bnQgPyBzdW0gLyBudW1lcmljQ291bnQgOiBudWxsLFxuICAgICAgbnVtZXJpY0NvdW50LFxuICAgICAgY291bnQ6IHBvcHVsYXRlZENvdW50LFxuICAgICAgaGFzTm9uTnVtZXJpYyxcbiAgICB9O1xuICB9XG5cbiAgcHJpdmF0ZSBjb2VyY2VUb051bWJlcih2YWx1ZTogYW55KTogbnVtYmVyIHwgbnVsbCB7XG4gICAgaWYgKHZhbHVlID09PSAnJyB8fCB2YWx1ZSA9PT0gbnVsbCB8fCB2YWx1ZSA9PT0gdW5kZWZpbmVkKSByZXR1cm4gbnVsbDtcbiAgICBpZiAodHlwZW9mIHZhbHVlID09PSAnbnVtYmVyJyAmJiBOdW1iZXIuaXNGaW5pdGUodmFsdWUpKSByZXR1cm4gdmFsdWU7XG4gICAgY29uc3QgcGFyc2VkID0gTnVtYmVyKHZhbHVlKTtcbiAgICByZXR1cm4gTnVtYmVyLmlzRmluaXRlKHBhcnNlZCkgPyBwYXJzZWQgOiBudWxsO1xuICB9XG5cbiAgcHJpdmF0ZSBpc1ZhbHVlRW1wdHkodmFsdWU6IGFueSk6IGJvb2xlYW4ge1xuICAgIGlmICh2YWx1ZSA9PT0gbnVsbCB8fCB2YWx1ZSA9PT0gdW5kZWZpbmVkKSByZXR1cm4gdHJ1ZTtcbiAgICBpZiAodHlwZW9mIHZhbHVlID09PSAnc3RyaW5nJykgcmV0dXJuIHZhbHVlLnRyaW0oKSA9PT0gJyc7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG5cclxuICBhcHBseUZvcm11bGFCYXIoKSB7XHJcbiAgICBpZiAoIXRoaXMuaG90KSByZXR1cm47XHJcbiAgICB0aGlzLmhvdC5zZXREYXRhQXRDZWxsKHRoaXMuc2VsZWN0ZWRSb3csIHRoaXMuc2VsZWN0ZWRDb2wsIHRoaXMuZm9ybXVsYVRleHQpO1xyXG4gIH1cclxuXHJcbiAgLy8gPT09PT0gRXhjZWwtbGlrZSB0b29sYmFyIGFjdGlvbnMgPT09PT1cclxuICBwcml2YXRlIGZvckVhY2hDZWxsSW5TZWxlY3Rpb24oY2I6IChyOiBudW1iZXIsIGM6IG51bWJlcikgPT4gdm9pZCkge1xuICAgIGlmICghdGhpcy5ob3QpIHJldHVybjtcbiAgICAvLyBAdHMtaWdub3JlIC0gZ2V0U2VsZWN0ZWRSYW5nZSBtYXkgYmUgdHlwZWQgbG9vc2VseSBkZXBlbmRpbmcgb24gdmVyc2lvblxuICAgIGNvbnN0IHJhbmdlcyA9IHRoaXMuaG90LmdldFNlbGVjdGVkUmFuZ2U/LigpIHx8IFtdO1xuICAgIGlmIChyYW5nZXMubGVuZ3RoKSB7XG4gICAgICByYW5nZXMuZm9yRWFjaCgocmFuZ2U6IGFueSkgPT4ge1xuICAgICAgICBjb25zdCByMSA9IE1hdGgubWluKHJhbmdlLmZyb20ucm93LCByYW5nZS50by5yb3cpO1xuICAgICAgICBjb25zdCByMiA9IE1hdGgubWF4KHJhbmdlLmZyb20ucm93LCByYW5nZS50by5yb3cpO1xuICAgICAgICBjb25zdCBjMSA9IE1hdGgubWluKHJhbmdlLmZyb20uY29sLCByYW5nZS50by5jb2wpO1xuICAgICAgICBjb25zdCBjMiA9IE1hdGgubWF4KHJhbmdlLmZyb20uY29sLCByYW5nZS50by5jb2wpO1xuICAgICAgICBmb3IgKGxldCByID0gcjE7IHIgPD0gcjI7IHIrKykge1xuICAgICAgICAgIGZvciAobGV0IGMgPSBjMTsgYyA8PSBjMjsgYysrKSB7XG4gICAgICAgICAgICBjYihyLCBjKTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBpZiAodGhpcy5sYXN0U2VsZWN0aW9uKSB7XG4gICAgICBmb3IgKGxldCByID0gdGhpcy5sYXN0U2VsZWN0aW9uLnIxOyByIDw9IHRoaXMubGFzdFNlbGVjdGlvbi5yMjsgcisrKSB7XG4gICAgICAgIGZvciAobGV0IGMgPSB0aGlzLmxhc3RTZWxlY3Rpb24uYzE7IGMgPD0gdGhpcy5sYXN0U2VsZWN0aW9uLmMyOyBjKyspIHtcbiAgICAgICAgICBjYihyLCBjKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBjYih0aGlzLnNlbGVjdGVkUm93LCB0aGlzLnNlbGVjdGVkQ29sKTtcbiAgfVxuXHJcbiAgcHJpdmF0ZSB1cGRhdGVDbGFzc09uU2VsZWN0aW9uKGFkZENsYXNzZXM6IHN0cmluZ1tdID0gW10sIHJlbW92ZUNsYXNzZXM6IHN0cmluZ1tdID0gW10pIHtcclxuICAgIGlmICghdGhpcy5ob3QpIHJldHVybjtcclxuICAgIGNvbnN0IGFkZFNldCA9IG5ldyBTZXQoYWRkQ2xhc3Nlcy5maWx0ZXIoQm9vbGVhbikpO1xyXG4gICAgY29uc3QgcmVtb3ZlU2V0ID0gbmV3IFNldChyZW1vdmVDbGFzc2VzLmZpbHRlcihCb29sZWFuKSk7XHJcbiAgICB0aGlzLmZvckVhY2hDZWxsSW5TZWxlY3Rpb24oKHIsIGMpID0+IHtcclxuICAgICAgY29uc3QgbWV0YSA9IHRoaXMuaG90IS5nZXRDZWxsTWV0YShyLCBjKSBhcyBhbnk7XHJcbiAgICAgIGNvbnN0IGV4aXN0aW5nID0gKG1ldGEuY2xhc3NOYW1lIHx8ICcnKS5zcGxpdCgvXFxzKy8pLmZpbHRlcihCb29sZWFuKTtcclxuICAgICAgbGV0IHNldCA9IG5ldyBTZXQoZXhpc3RpbmcpO1xyXG4gICAgICByZW1vdmVTZXQuZm9yRWFjaChjbHMgPT4gc2V0LmRlbGV0ZShjbHMpKTtcclxuICAgICAgYWRkU2V0LmZvckVhY2goY2xzID0+IHNldC5hZGQoY2xzKSk7XHJcbiAgICAgIGNvbnN0IG5leHQgPSBBcnJheS5mcm9tKHNldCkuam9pbignICcpO1xyXG4gICAgICB0aGlzLmhvdCEuc2V0Q2VsbE1ldGEociwgYywgJ2NsYXNzTmFtZScsIG5leHQpO1xyXG4gICAgfSk7XHJcbiAgICB0aGlzLmhvdC5yZW5kZXIoKTtcclxuICB9XHJcblxyXG4gIHRvZ2dsZUJvbGQoKSB7XHJcbiAgICBpZiAoIXRoaXMuaG90KSByZXR1cm47XHJcbiAgICAvLyBTaW1wbGUgdG9nZ2xlOiBpZiBmaXJzdCBjZWxsIGhhcyBodEJvbGQgdGhlbiByZW1vdmUsIGVsc2UgYWRkXHJcbiAgICBjb25zdCBtZXRhID0gdGhpcy5ob3QuZ2V0Q2VsbE1ldGEodGhpcy5zZWxlY3RlZFJvdywgdGhpcy5zZWxlY3RlZENvbCkgYXMgYW55O1xyXG4gICAgY29uc3QgaGFzID0gKG1ldGEuY2xhc3NOYW1lIHx8ICcnKS5zcGxpdCgvXFxzKy8pLmluY2x1ZGVzKCdodEJvbGQnKTtcclxuICAgIGlmIChoYXMpIHRoaXMudXBkYXRlQ2xhc3NPblNlbGVjdGlvbihbXSwgWydodEJvbGQnXSk7IGVsc2UgdGhpcy51cGRhdGVDbGFzc09uU2VsZWN0aW9uKFsnaHRCb2xkJ10pO1xyXG4gIH1cclxuXHJcbiAgYWxpZ24od2hlcmU6ICdsZWZ0JyB8ICdjZW50ZXInIHwgJ3JpZ2h0Jykge1xyXG4gICAgY29uc3QgbWFwOiBhbnkgPSB7IGxlZnQ6ICdodExlZnQnLCBjZW50ZXI6ICdodENlbnRlcicsIHJpZ2h0OiAnaHRSaWdodCcgfTtcclxuICAgIHRoaXMudXBkYXRlQ2xhc3NPblNlbGVjdGlvbihbbWFwW3doZXJlXV0sIFsnaHRMZWZ0JywgJ2h0Q2VudGVyJywgJ2h0UmlnaHQnXSk7XHJcbiAgfVxyXG5cclxuICB0b2dnbGVXcmFwKCkge1xyXG4gICAgaWYgKCF0aGlzLmhvdCkgcmV0dXJuO1xyXG4gICAgY29uc3QgbWV0YSA9IHRoaXMuaG90LmdldENlbGxNZXRhKHRoaXMuc2VsZWN0ZWRSb3csIHRoaXMuc2VsZWN0ZWRDb2wpIGFzIGFueTtcclxuICAgIGNvbnN0IGhhcyA9IChtZXRhLmNsYXNzTmFtZSB8fCAnJykuc3BsaXQoL1xccysvKS5pbmNsdWRlcygnaHRXcmFwJyk7XHJcbiAgICBpZiAoaGFzKSB0aGlzLnVwZGF0ZUNsYXNzT25TZWxlY3Rpb24oW10sIFsnaHRXcmFwJ10pOyBlbHNlIHRoaXMudXBkYXRlQ2xhc3NPblNlbGVjdGlvbihbJ2h0V3JhcCddKTtcclxuICB9XHJcblxyXG4gIC8vID09PT09IFF1aWNrIGZ1bmN0aW9ucyBiYXNlZCBvbiBjdXJyZW50IHNlbGVjdGlvbiA9PT09PVxyXG4gIHByaXZhdGUgZ2V0Rmlyc3RTZWxlY3Rpb25SYW5nZSgpIHtcclxuICAgIC8vIEB0cy1pZ25vcmVcclxuICAgIGNvbnN0IHJhbmdlcyA9IHRoaXMuaG90Py5nZXRTZWxlY3RlZFJhbmdlPy4oKTtcclxuICAgIGlmICghcmFuZ2VzIHx8ICFyYW5nZXMubGVuZ3RoKSByZXR1cm4gbnVsbDtcclxuICAgIGNvbnN0IHIgPSByYW5nZXNbMF07XHJcbiAgICBjb25zdCByMSA9IE1hdGgubWluKHIuZnJvbS5yb3csIHIudG8ucm93KTtcclxuICAgIGNvbnN0IHIyID0gTWF0aC5tYXgoci5mcm9tLnJvdywgci50by5yb3cpO1xyXG4gICAgY29uc3QgYzEgPSBNYXRoLm1pbihyLmZyb20uY29sLCByLnRvLmNvbCk7XHJcbiAgICBjb25zdCBjMiA9IE1hdGgubWF4KHIuZnJvbS5jb2wsIHIudG8uY29sKTtcclxuICAgIHJldHVybiB7IHIxLCByMiwgYzEsIGMyIH07XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIHJhbmdlVG9BMShyMTogbnVtYmVyLCBjMTogbnVtYmVyLCByMjogbnVtYmVyLCBjMjogbnVtYmVyKSB7XHJcbiAgICBjb25zdCBzdGFydCA9IGAke3RoaXMuY29sVG9MZXR0ZXIoYzEpfSR7cjEgKyAxfWA7XHJcbiAgICBjb25zdCBlbmQgPSBgJHt0aGlzLmNvbFRvTGV0dGVyKGMyKX0ke3IyICsgMX1gO1xyXG4gICAgcmV0dXJuIHIxID09PSByMiAmJiBjMSA9PT0gYzIgPyBzdGFydCA6IGAke3N0YXJ0fToke2VuZH1gO1xyXG4gIH1cclxuXHJcbiAgYWRkU3VtT3ZlclNlbGVjdGlvbigpIHtcclxuICAgIGNvbnN0IHNlbCA9IHRoaXMuZ2V0Rmlyc3RTZWxlY3Rpb25SYW5nZSgpO1xyXG4gICAgaWYgKCFzZWwpIHJldHVybjtcclxuICAgIC8vIElmIHNlbGVjdGlvbiBpcyBhIHNpbmdsZSBjZWxsIChsaWtlbHkgY3VycmVudCBjZWxsKSwgZGVmYXVsdCB0byBzdW1taW5nIHRoZSBjb2x1bW4gYWJvdmUgaXQgKHNraXAgcm93IDAgaGVhZGVyKVxyXG4gICAgaWYgKHNlbC5yMSA9PT0gc2VsLnIyICYmIHNlbC5jMSA9PT0gc2VsLmMyKSB7XHJcbiAgICAgIGNvbnN0IGNvbCA9IHRoaXMuc2VsZWN0ZWRDb2w7XHJcbiAgICAgIGNvbnN0IHN0YXJ0Um93ID0gMTsgLy8gYXNzdW1lIGZpcnN0IHJvdyBpcyBoZWFkZXIgaW4gb3VyIEFPQVxyXG4gICAgICBjb25zdCBlbmRSb3cgPSBNYXRoLm1heChzdGFydFJvdywgdGhpcy5zZWxlY3RlZFJvdyAtIDEpO1xyXG4gICAgICBpZiAoZW5kUm93ID49IHN0YXJ0Um93KSB7XHJcbiAgICAgICAgY29uc3QgYTFjb2wgPSB0aGlzLnJhbmdlVG9BMShzdGFydFJvdywgY29sLCBlbmRSb3csIGNvbCk7XHJcbiAgICAgICAgdGhpcy5mb3JtdWxhVGV4dCA9IGA9U1VNKCR7YTFjb2x9KWA7XHJcbiAgICAgICAgdGhpcy5hcHBseUZvcm11bGFCYXIoKTtcclxuICAgICAgICByZXR1cm47XHJcbiAgICAgIH1cclxuICAgIH1cclxuICAgIC8vIElmIGN1cnJlbnQgY2VsbCBpcyBpbnNpZGUgdGhlIHNlbGVjdGVkIHJhbmdlLCBleGNsdWRlIGl0IHRvIGF2b2lkIGNpcmN1bGFyIHJlZmVyZW5jZVxyXG4gICAgY29uc3Qgd2l0aGluID0gdGhpcy5zZWxlY3RlZFJvdyA+PSBzZWwucjEgJiYgdGhpcy5zZWxlY3RlZFJvdyA8PSBzZWwucjIgJiYgdGhpcy5zZWxlY3RlZENvbCA+PSBzZWwuYzEgJiYgdGhpcy5zZWxlY3RlZENvbCA8PSBzZWwuYzI7XHJcbiAgICBjb25zdCBzdW1BcmdzID0gd2l0aGluXHJcbiAgICAgID8gdGhpcy5idWlsZFN1bUFyZ3NFeGNsdWRpbmdBY3RpdmUoc2VsLnIxLCBzZWwuYzEsIHNlbC5yMiwgc2VsLmMyLCB0aGlzLnNlbGVjdGVkUm93LCB0aGlzLnNlbGVjdGVkQ29sKVxyXG4gICAgICA6IHRoaXMucmFuZ2VUb0ExKHNlbC5yMSwgc2VsLmMxLCBzZWwucjIsIHNlbC5jMik7XHJcbiAgICB0aGlzLmZvcm11bGFUZXh0ID0gYD1TVU0oJHtzdW1BcmdzfSlgO1xyXG4gICAgdGhpcy5hcHBseUZvcm11bGFCYXIoKTtcclxuICB9XHJcblxyXG4gIGFkZEF2Z092ZXJTZWxlY3Rpb24oKSB7XHJcbiAgICBjb25zdCBzZWwgPSB0aGlzLmdldEZpcnN0U2VsZWN0aW9uUmFuZ2UoKTtcclxuICAgIGlmICghc2VsKSByZXR1cm47XHJcbiAgICBpZiAoc2VsLnIxID09PSBzZWwucjIgJiYgc2VsLmMxID09PSBzZWwuYzIpIHtcclxuICAgICAgY29uc3QgY29sID0gdGhpcy5zZWxlY3RlZENvbDtcclxuICAgICAgY29uc3Qgc3RhcnRSb3cgPSAxO1xyXG4gICAgICBjb25zdCBlbmRSb3cgPSBNYXRoLm1heChzdGFydFJvdywgdGhpcy5zZWxlY3RlZFJvdyAtIDEpO1xyXG4gICAgICBpZiAoZW5kUm93ID49IHN0YXJ0Um93KSB7XHJcbiAgICAgICAgY29uc3QgYTFjb2wgPSB0aGlzLnJhbmdlVG9BMShzdGFydFJvdywgY29sLCBlbmRSb3csIGNvbCk7XHJcbiAgICAgICAgdGhpcy5mb3JtdWxhVGV4dCA9IGA9QVZFUkFHRSgke2ExY29sfSlgO1xyXG4gICAgICAgIHRoaXMuYXBwbHlGb3JtdWxhQmFyKCk7XHJcbiAgICAgICAgcmV0dXJuO1xyXG4gICAgICB9XHJcbiAgICB9XHJcbiAgICBjb25zdCB3aXRoaW4gPSB0aGlzLnNlbGVjdGVkUm93ID49IHNlbC5yMSAmJiB0aGlzLnNlbGVjdGVkUm93IDw9IHNlbC5yMiAmJiB0aGlzLnNlbGVjdGVkQ29sID49IHNlbC5jMSAmJiB0aGlzLnNlbGVjdGVkQ29sIDw9IHNlbC5jMjtcclxuICAgIGNvbnN0IGFyZ3MgPSB3aXRoaW5cclxuICAgICAgPyB0aGlzLmJ1aWxkU3VtQXJnc0V4Y2x1ZGluZ0FjdGl2ZShzZWwucjEsIHNlbC5jMSwgc2VsLnIyLCBzZWwuYzIsIHRoaXMuc2VsZWN0ZWRSb3csIHRoaXMuc2VsZWN0ZWRDb2wpXHJcbiAgICAgIDogdGhpcy5yYW5nZVRvQTEoc2VsLnIxLCBzZWwuYzEsIHNlbC5yMiwgc2VsLmMyKTtcclxuICAgIHRoaXMuZm9ybXVsYVRleHQgPSBgPUFWRVJBR0UoJHthcmdzfSlgO1xyXG4gICAgdGhpcy5hcHBseUZvcm11bGFCYXIoKTtcclxuICB9XHJcblxyXG4gIGFkZENvdW50T3ZlclNlbGVjdGlvbigpIHtcclxuICAgIGNvbnN0IHNlbCA9IHRoaXMuZ2V0Rmlyc3RTZWxlY3Rpb25SYW5nZSgpO1xyXG4gICAgaWYgKCFzZWwpIHJldHVybjtcclxuICAgIGlmIChzZWwucjEgPT09IHNlbC5yMiAmJiBzZWwuYzEgPT09IHNlbC5jMikge1xyXG4gICAgICBjb25zdCBjb2wgPSB0aGlzLnNlbGVjdGVkQ29sO1xyXG4gICAgICBjb25zdCBzdGFydFJvdyA9IDE7XHJcbiAgICAgIGNvbnN0IGVuZFJvdyA9IE1hdGgubWF4KHN0YXJ0Um93LCB0aGlzLnNlbGVjdGVkUm93IC0gMSk7XHJcbiAgICAgIGlmIChlbmRSb3cgPj0gc3RhcnRSb3cpIHtcclxuICAgICAgICBjb25zdCBhMWNvbCA9IHRoaXMucmFuZ2VUb0ExKHN0YXJ0Um93LCBjb2wsIGVuZFJvdywgY29sKTtcclxuICAgICAgICB0aGlzLmZvcm11bGFUZXh0ID0gYD1DT1VOVCgke2ExY29sfSlgO1xyXG4gICAgICAgIHRoaXMuYXBwbHlGb3JtdWxhQmFyKCk7XHJcbiAgICAgICAgcmV0dXJuO1xyXG4gICAgICB9XHJcbiAgICB9XHJcbiAgICBjb25zdCB3aXRoaW4gPSB0aGlzLnNlbGVjdGVkUm93ID49IHNlbC5yMSAmJiB0aGlzLnNlbGVjdGVkUm93IDw9IHNlbC5yMiAmJiB0aGlzLnNlbGVjdGVkQ29sID49IHNlbC5jMSAmJiB0aGlzLnNlbGVjdGVkQ29sIDw9IHNlbC5jMjtcclxuICAgIGNvbnN0IGFyZ3MgPSB3aXRoaW5cclxuICAgICAgPyB0aGlzLmJ1aWxkU3VtQXJnc0V4Y2x1ZGluZ0FjdGl2ZShzZWwucjEsIHNlbC5jMSwgc2VsLnIyLCBzZWwuYzIsIHRoaXMuc2VsZWN0ZWRSb3csIHRoaXMuc2VsZWN0ZWRDb2wpXHJcbiAgICAgIDogdGhpcy5yYW5nZVRvQTEoc2VsLnIxLCBzZWwuYzEsIHNlbC5yMiwgc2VsLmMyKTtcclxuICAgIHRoaXMuZm9ybXVsYVRleHQgPSBgPUNPVU5UKCR7YXJnc30pYDtcclxuICAgIHRoaXMuYXBwbHlGb3JtdWxhQmFyKCk7XHJcbiAgfVxyXG5cclxuICAvLyBCdWlsZCBjb21tYS1zZXBhcmF0ZWQgU1VNIGFyZ3VtZW50cyBjb3ZlcmluZyBhIHJlY3RhbmdsZSBidXQgZXhjbHVkaW5nIHRoZSBhY3RpdmUgY2VsbFxyXG4gIHByaXZhdGUgYnVpbGRTdW1BcmdzRXhjbHVkaW5nQWN0aXZlKHIxOiBudW1iZXIsIGMxOiBudW1iZXIsIHIyOiBudW1iZXIsIGMyOiBudW1iZXIsIGFyOiBudW1iZXIsIGFjOiBudW1iZXIpOiBzdHJpbmcge1xyXG4gICAgY29uc3QgcGFydHM6IHN0cmluZ1tdID0gW107XHJcbiAgICAvLyBUb3AgYmxvY2sgKHJvd3MgYWJvdmUgYWN0aXZlIHJvdylcclxuICAgIGlmIChhciAtIDEgPj0gcjEpIHtcclxuICAgICAgcGFydHMucHVzaCh0aGlzLnJhbmdlVG9BMShyMSwgYzEsIGFyIC0gMSwgYzIpKTtcclxuICAgIH1cclxuICAgIC8vIEJvdHRvbSBibG9jayAocm93cyBiZWxvdyBhY3RpdmUgcm93KVxyXG4gICAgaWYgKGFyICsgMSA8PSByMikge1xyXG4gICAgICBwYXJ0cy5wdXNoKHRoaXMucmFuZ2VUb0ExKGFyICsgMSwgYzEsIHIyLCBjMikpO1xyXG4gICAgfVxyXG4gICAgLy8gU2FtZSByb3c6IGxlZnQgc2VnbWVudFxyXG4gICAgaWYgKGFjIC0gMSA+PSBjMSkge1xyXG4gICAgICBwYXJ0cy5wdXNoKHRoaXMucmFuZ2VUb0ExKGFyLCBjMSwgYXIsIGFjIC0gMSkpO1xyXG4gICAgfVxyXG4gICAgLy8gU2FtZSByb3c6IHJpZ2h0IHNlZ21lbnRcclxuICAgIGlmIChhYyArIDEgPD0gYzIpIHtcclxuICAgICAgcGFydHMucHVzaCh0aGlzLnJhbmdlVG9BMShhciwgYWMgKyAxLCBhciwgYzIpKTtcclxuICAgIH1cclxuICAgIC8vIEZhbGxiYWNrIGlmIG5vdGhpbmcgd2FzIGFkZGVkIChzaG91bGRuJ3QgaGFwcGVuIHVubGVzcyBzZWxlY3Rpb24gaXMgc2luZ2xlIGNlbGwpXHJcbiAgICByZXR1cm4gcGFydHMuZmlsdGVyKEJvb2xlYW4pLmpvaW4oJywnKTtcclxuICB9XHJcblxyXG4gIC8vID09PT09IEZpbmQgcGFuZWwgbG9naWMgdXNpbmcgSGFuZHNvbnRhYmxlIFNlYXJjaCBwbHVnaW4gPT09PT1cclxuICBvcGVuRmluZFBhbmVsKCkge1xyXG4gICAgdGhpcy5zaG93RmluZCA9IHRydWU7XHJcbiAgICBzZXRUaW1lb3V0KCgpID0+IHRoaXMuZmluZElucHV0Py5uYXRpdmVFbGVtZW50Py5mb2N1cygpLCAwKTtcclxuICB9XHJcbiAgY2xvc2VGaW5kUGFuZWwoKSB7XHJcbiAgICB0aGlzLnNob3dGaW5kID0gZmFsc2U7XHJcbiAgICB0aGlzLmNsZWFyRmluZCgpO1xyXG4gIH1cclxuICBydW5GaW5kKCkge1xuICAgIGlmICghdGhpcy5ob3QpIHJldHVybjtcbiAgICAvLyBVc2Ugc2VhcmNoIHBsdWdpblxuICAgIC8vIEB0cy1pZ25vcmVcbiAgICBjb25zdCBzZWFyY2ggPSB0aGlzLmhvdC5nZXRQbHVnaW4oJ3NlYXJjaCcpO1xuICAgIGNvbnN0IHF1ZXJ5ID0gdGhpcy5maW5kUXVlcnkgfHwgJyc7XG4gICAgY29uc3QgY21wID0gKHE6IHN0cmluZywgdmFsdWU6IGFueSkgPT4ge1xuICAgICAgaWYgKCFxKSByZXR1cm4gZmFsc2U7XG4gICAgICBjb25zdCB2YWwgPSB2YWx1ZSA9PSBudWxsID8gJycgOiBTdHJpbmcodmFsdWUpO1xuICAgICAgaWYgKHRoaXMuZmluZENhc2VTZW5zaXRpdmUpIHJldHVybiB2YWwuaW5kZXhPZihxKSAhPT0gLTE7XG4gICAgICByZXR1cm4gdmFsLnRvTG93ZXJDYXNlKCkuaW5kZXhPZihxLnRvTG93ZXJDYXNlKCkpICE9PSAtMTtcbiAgICB9O1xuICAgIGNvbnN0IHJlc3VsdHMgPSBzZWFyY2gucXVlcnkocXVlcnksIHVuZGVmaW5lZCwgKHFTdHI6IHN0cmluZywgdmFsdWU6IGFueSkgPT4gY21wKHFTdHIsIHZhbHVlKSkgfHwgW107XG4gICAgdGhpcy5maW5kUmVzdWx0cyA9IHJlc3VsdHMubWFwKChyOiBhbnkpID0+ICh7IHJvdzogci5yb3csIGNvbDogci5jb2wgfSkpO1xuICAgIHRoaXMuY3VycmVudEZpbmRJbmRleCA9IDA7XG4gICAgaWYgKHRoaXMuZmluZFJlc3VsdHMubGVuZ3RoKSB0aGlzLmdvdG9GaW5kSW5kZXgoMCk7XG4gICAgdGhpcy5ob3QucmVuZGVyKCk7XG4gIH1cbiAgY2xlYXJGaW5kKCkge1xyXG4gICAgdGhpcy5maW5kUXVlcnkgPSAnJztcclxuICAgIHRoaXMuZmluZFJlc3VsdHMgPSBbXTtcclxuICAgIHRoaXMuY3VycmVudEZpbmRJbmRleCA9IDA7XHJcbiAgICBpZiAodGhpcy5ob3QpIHtcclxuICAgICAgLy8gQ2xlYXIgaGlnaGxpZ2h0cyBieSBydW5uaW5nIGVtcHR5IHF1ZXJ5XHJcbiAgICAgIC8vIEB0cy1pZ25vcmVcclxuICAgICAgY29uc3Qgc2VhcmNoID0gdGhpcy5ob3QuZ2V0UGx1Z2luKCdzZWFyY2gnKTtcclxuICAgICAgc2VhcmNoLnF1ZXJ5KCcnKTtcclxuICAgICAgdGhpcy5ob3QucmVuZGVyKCk7XHJcbiAgICB9XHJcbiAgfVxyXG4gIGdvdG9GaW5kSW5kZXgoaWR4OiBudW1iZXIpIHtcclxuICAgIGlmICghdGhpcy5ob3QgfHwgIXRoaXMuZmluZFJlc3VsdHMubGVuZ3RoKSByZXR1cm47XHJcbiAgICBjb25zdCBuID0gdGhpcy5maW5kUmVzdWx0cy5sZW5ndGg7XHJcbiAgICB0aGlzLmN1cnJlbnRGaW5kSW5kZXggPSAoKGlkeCAlIG4pICsgbikgJSBuOyAvLyB3cmFwXHJcbiAgICBjb25zdCB7IHJvdywgY29sIH0gPSB0aGlzLmZpbmRSZXN1bHRzW3RoaXMuY3VycmVudEZpbmRJbmRleF07XHJcbiAgICB0aGlzLmhvdC5zZWxlY3RDZWxsKHJvdywgY29sLCByb3csIGNvbCwgdHJ1ZSwgdHJ1ZSk7XHJcbiAgICB0aGlzLnVwZGF0ZVNlbGVjdGlvbihyb3csIGNvbCk7XHJcbiAgfVxyXG4gIG5leHRGaW5kKCkgeyB0aGlzLmdvdG9GaW5kSW5kZXgodGhpcy5jdXJyZW50RmluZEluZGV4ICsgMSk7IH1cbiAgcHJldkZpbmQoKSB7IHRoaXMuZ290b0ZpbmRJbmRleCh0aGlzLmN1cnJlbnRGaW5kSW5kZXggLSAxKTsgfVxuXG4gIHJlcGxhY2VDdXJyZW50KCkge1xuICAgIGlmICghdGhpcy5ob3QgfHwgIXRoaXMuZmluZFF1ZXJ5KSByZXR1cm47XG4gICAgaWYgKCF0aGlzLmZpbmRSZXN1bHRzLmxlbmd0aCkge1xuICAgICAgdGhpcy5ydW5GaW5kKCk7XG4gICAgICBpZiAoIXRoaXMuZmluZFJlc3VsdHMubGVuZ3RoKSByZXR1cm47XG4gICAgfVxuICAgIGNvbnN0IHsgcm93LCBjb2wgfSA9IHRoaXMuZmluZFJlc3VsdHNbdGhpcy5jdXJyZW50RmluZEluZGV4XTtcbiAgICBjb25zdCBjdXJyZW50VmFsdWUgPSB0aGlzLmhvdC5nZXREYXRhQXRDZWxsKHJvdywgY29sKTtcbiAgICBjb25zdCBuZXh0ID0gdGhpcy5idWlsZFJlcGxhY2VtZW50KFN0cmluZyhjdXJyZW50VmFsdWUgPz8gJycpLCBmYWxzZSk7XG4gICAgaWYgKG5leHQgPT09IG51bGwpIHJldHVybjtcbiAgICB0aGlzLmhvdC5zZXREYXRhQXRDZWxsKHJvdywgY29sLCBuZXh0KTtcbiAgICB0aGlzLmhvdC5yZW5kZXIoKTtcbiAgICB0aGlzLnJ1bkZpbmQoKTtcbiAgfVxuXG4gIHJlcGxhY2VBbGxNYXRjaGVzKCkge1xuICAgIGlmICghdGhpcy5ob3QgfHwgIXRoaXMuZmluZFF1ZXJ5KSByZXR1cm47XG4gICAgY29uc3Qgcm93cyA9IHRoaXMuaG90LmNvdW50Um93cz8uKCkgPz8gMDtcbiAgICBjb25zdCBjb2xzID0gdGhpcy5ob3QuY291bnRDb2xzPy4oKSA/PyAwO1xuICAgIGlmICghcm93cyB8fCAhY29scykgcmV0dXJuO1xuICAgIGxldCBkaWRSZXBsYWNlID0gZmFsc2U7XG4gICAgZm9yIChsZXQgciA9IDA7IHIgPCByb3dzOyByKyspIHtcbiAgICAgIGZvciAobGV0IGMgPSAwOyBjIDwgY29sczsgYysrKSB7XG4gICAgICAgIGNvbnN0IHZhbHVlID0gdGhpcy5ob3QuZ2V0RGF0YUF0Q2VsbChyLCBjKTtcbiAgICAgICAgY29uc3QgbmV4dCA9IHRoaXMuYnVpbGRSZXBsYWNlbWVudChTdHJpbmcodmFsdWUgPz8gJycpLCB0cnVlKTtcbiAgICAgICAgaWYgKG5leHQgIT09IG51bGwpIHtcbiAgICAgICAgICB0aGlzLmhvdC5zZXREYXRhQXRDZWxsKHIsIGMsIG5leHQpO1xuICAgICAgICAgIGRpZFJlcGxhY2UgPSB0cnVlO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICAgIGlmIChkaWRSZXBsYWNlKSB7XG4gICAgICB0aGlzLmhvdC5yZW5kZXIoKTtcbiAgICB9XG4gICAgdGhpcy5ydW5GaW5kKCk7XG4gIH1cblxuICBwcml2YXRlIGJ1aWxkUmVwbGFjZW1lbnQodmFsdWU6IHN0cmluZywgYWxsT2NjdXJyZW5jZXM6IGJvb2xlYW4pOiBzdHJpbmcgfCBudWxsIHtcbiAgICBjb25zdCBxdWVyeSA9IHRoaXMuZmluZFF1ZXJ5O1xuICAgIGlmICghcXVlcnkpIHJldHVybiBudWxsO1xuICAgIGNvbnN0IGZsYWdzID0gdGhpcy5maW5kQ2FzZVNlbnNpdGl2ZSA/ICcnIDogJ2knO1xuICAgIGNvbnN0IGVzY2FwZWQgPSB0aGlzLmVzY2FwZVJlZ0V4cChxdWVyeSk7XG4gICAgY29uc3QgcmUgPSBuZXcgUmVnRXhwKGVzY2FwZWQsIGFsbE9jY3VycmVuY2VzID8gYGcke2ZsYWdzfWAgOiBmbGFncyk7XG4gICAgaWYgKCFyZS50ZXN0KHZhbHVlKSkgcmV0dXJuIG51bGw7XG4gICAgcmUubGFzdEluZGV4ID0gMDsgLy8gcmVzZXQgZm9yIHJldXNlXG4gICAgcmV0dXJuIHZhbHVlLnJlcGxhY2UocmUsIHRoaXMucmVwbGFjZVRleHQgPz8gJycpO1xuICB9XG5cbiAgcHJpdmF0ZSBlc2NhcGVSZWdFeHAoc3RyOiBzdHJpbmcpOiBzdHJpbmcge1xuICAgIHJldHVybiBzdHIucmVwbGFjZSgvWy4qKz9eJHt9KCl8W1xcXVxcXFxdL2csICdcXFxcJCYnKTtcbiAgfVxuICBcclxuICAvLyBFbnN1cmUgY2VsbHMgYXJlIHByaW1pdGl2ZXMgYWNjZXB0YWJsZSBieSBIYW5kc29udGFibGUvSHlwZXJGb3JtdWxhXHJcbiAgcHJpdmF0ZSBzYW5pdGl6ZUNlbGwodmFsdWU6IGFueSk6IHN0cmluZyB8IG51bWJlciB8IGJvb2xlYW4gfCBudWxsIHtcclxuICAgIGlmICh2YWx1ZSA9PT0gbnVsbCB8fCB2YWx1ZSA9PT0gdW5kZWZpbmVkKSByZXR1cm4gJyc7XHJcbiAgICBpZiAoQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHJldHVybiB2YWx1ZS5qb2luKCcsICcpO1xyXG4gICAgY29uc3QgdCA9IHR5cGVvZiB2YWx1ZTtcclxuICAgIGlmICh0ID09PSAnc3RyaW5nJyB8fCB0ID09PSAnbnVtYmVyJyB8fCB0ID09PSAnYm9vbGVhbicpIHJldHVybiB2YWx1ZSBhcyBhbnk7XHJcbiAgICBpZiAodmFsdWUgaW5zdGFuY2VvZiBEYXRlKSByZXR1cm4gdmFsdWUudG9JU09TdHJpbmcoKTtcclxuICAgIHRyeSB7XHJcbiAgICAgIHJldHVybiBKU09OLnN0cmluZ2lmeSh2YWx1ZSk7XHJcbiAgICB9IGNhdGNoIHtcclxuICAgICAgcmV0dXJuIFN0cmluZyh2YWx1ZSk7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIHNhbml0aXplQW9hKGFvYTogYW55W11bXSk6IChzdHJpbmcgfCBudW1iZXIgfCBib29sZWFuIHwgbnVsbClbXVtdIHtcclxuICAgIHJldHVybiAoYW9hIHx8IFtdKS5tYXAocm93ID0+IEFycmF5LmlzQXJyYXkocm93KSA/IHJvdy5tYXAoYyA9PiB0aGlzLnNhbml0aXplQ2VsbChjKSkgOiBbdGhpcy5zYW5pdGl6ZUNlbGwocm93KV0pO1xyXG4gIH1cclxuXHJcbiAgLy8gUmVtb3ZlIGxlYWRpbmcgZW50aXJlbHkgZW1wdHkgcm93cyBzbyB0aGUgaGVhZGVyIGlzIGF0IHRoZSB2ZXJ5IHRvcFxyXG4gIHByaXZhdGUgdHJpbUxlYWRpbmdFbXB0eVJvd3MoYW9hOiAoc3RyaW5nIHwgbnVtYmVyIHwgYm9vbGVhbiB8IG51bGwpW11bXSk6IChzdHJpbmcgfCBudW1iZXIgfCBib29sZWFuIHwgbnVsbClbXVtdIHtcclxuICAgIGNvbnN0IGlzRW1wdHkgPSAodjogYW55KSA9PiB2ID09PSAnJyB8fCB2ID09PSBudWxsIHx8IHYgPT09IHVuZGVmaW5lZDtcclxuICAgIGxldCBzdGFydCA9IDA7XHJcbiAgICB3aGlsZSAoc3RhcnQgPCAoYW9hPy5sZW5ndGggfHwgMCkpIHtcclxuICAgICAgY29uc3Qgcm93ID0gYW9hW3N0YXJ0XSB8fCBbXTtcclxuICAgICAgaWYgKHJvdy5zb21lKGNlbGwgPT4gIWlzRW1wdHkoY2VsbCkpKSBicmVhaztcclxuICAgICAgc3RhcnQrKztcclxuICAgIH1cclxuICAgIHJldHVybiAoYW9hIHx8IFtdKS5zbGljZShzdGFydCk7XHJcbiAgfVxyXG5cclxuICBcclxuICBuZ09uQ2hhbmdlcyhjaGFuZ2VzOiBTaW1wbGVDaGFuZ2VzKTogdm9pZCB7XHJcbiAgICBpZiAoY2hhbmdlc1snZGF0YSddIHx8IGNoYW5nZXNbJ2NvbHVtbnMnXSB8fCBjaGFuZ2VzWydzaGVldE5hbWUnXSkge1xyXG4gICAgICBjb25zb2xlLmxvZygnY2hhbmdlcycsIGNoYW5nZXMpXHJcbiAgICAgIGlmIChBcnJheS5pc0FycmF5KHRoaXMuZGF0YSkgJiYgdGhpcy5kYXRhLmxlbmd0aCA+IDApIHtcclxuICAgICAgICB0aGlzLnNldFNoZWV0RnJvbU9iamVjdHModGhpcy5kYXRhLCB0aGlzLmNvbHVtbnMsIHRoaXMuc2hlZXROYW1lIHx8ICdTaGVldDEnKTtcclxuICAgICAgfSBlbHNlIGlmIChBcnJheS5pc0FycmF5KHRoaXMuZGF0YSkgJiYgdGhpcy5kYXRhLmxlbmd0aCA9PT0gMCkge1xyXG4gICAgICAgIC8vIElmIGV4cGxpY2l0bHkgcGFzc2VkIGVtcHR5IGRhdGEsIGNsZWFyIHRoZSB0YWJsZVxyXG4gICAgICAgIHRoaXMuZXhjZWxEYXRhID0gW107XHJcbiAgICAgICAgdGhpcy53b3JrYm9vayA9IHVuZGVmaW5lZDtcclxuICAgICAgICB0aGlzLnNoZWV0TmFtZXMgPSBbXTtcclxuICAgICAgICB0aGlzLnNlbGVjdGVkU2hlZXQgPSAnJztcclxuICAgICAgfVxyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgc2V0U2hlZXRGcm9tT2JqZWN0cyhyb3dzOiBhbnlbXSwgY29scz86IHsgZmllbGQ6IHN0cmluZzsgaGVhZGVyPzogc3RyaW5nIH1bXSwgbmFtZTogc3RyaW5nID0gJ1NoZWV0MScpIHtcclxuICAgIGNvbnN0IHJlc29sdmVkQ29scyA9IGNvbHMgJiYgY29scy5sZW5ndGhcclxuICAgICAgPyBjb2xzLm1hcChjID0+ICh7IGZpZWxkOiBjLmZpZWxkLCBoZWFkZXI6IGMuaGVhZGVyIHx8IGMuZmllbGQgfSkpXHJcbiAgICAgIDogT2JqZWN0LmtleXMocm93c1swXSB8fCB7fSkubWFwKGsgPT4gKHsgZmllbGQ6IGssIGhlYWRlcjogayB9KSk7XHJcblxyXG4gICAgY29uc3QgZXhjbHVkZXMgPSAodGhpcy5leGNsdWRlQ29sdW1ucyB8fCBbXSkubWFwKGUgPT4gU3RyaW5nKGUpLnRvTG93ZXJDYXNlKCkpO1xyXG4gICAgY29uc3QgZmlsdGVyZWRDb2xzID0gcmVzb2x2ZWRDb2xzLmZpbHRlcihjID0+IHtcclxuICAgICAgY29uc3QgZiA9IChjLmZpZWxkIHx8ICcnKS50b1N0cmluZygpLnRvTG93ZXJDYXNlKCk7XHJcbiAgICAgIGNvbnN0IGggPSAoYy5oZWFkZXIgfHwgJycpLnRvU3RyaW5nKCkudG9Mb3dlckNhc2UoKTtcclxuICAgICAgcmV0dXJuICEoZXhjbHVkZXMuaW5jbHVkZXMoZikgfHwgZXhjbHVkZXMuaW5jbHVkZXMoaCkpO1xyXG4gICAgfSk7XHJcbiAgICBjb25zdCBmaW5hbENvbHMgPSBmaWx0ZXJlZENvbHMubGVuZ3RoID4gMCA/IGZpbHRlcmVkQ29scyA6IHJlc29sdmVkQ29scztcclxuXHJcbiAgICBjb25zdCBoZWFkZXJSb3cgPSBmaW5hbENvbHMubWFwKGMgPT4gYy5oZWFkZXIpO1xyXG4gICAgY29uc3QgZGF0YVJvd3MgPSByb3dzLm1hcChyID0+IGZpbmFsQ29scy5tYXAoYyA9PiB0aGlzLnNhbml0aXplQ2VsbChyPy5bYy5maWVsZF0pKSk7XHJcbiAgICBjb25zdCBhb2EgPSBbaGVhZGVyUm93LCAuLi5kYXRhUm93c107XHJcbiAgICBjb25zdCBjbGVhbiA9IHRoaXMuc2FuaXRpemVBb2EoYW9hKTtcclxuICAgIHRoaXMuZXhjZWxEYXRhID0gKGNsZWFuICYmIGNsZWFuLmxlbmd0aCkgPyBjbGVhbiA6IFtbJyddXTtcclxuICAgIHRoaXMud29ya2Jvb2sgPSB1bmRlZmluZWQ7XHJcbiAgICB0aGlzLnNoZWV0TmFtZXMgPSBbbmFtZV07XHJcbiAgICB0aGlzLnNlbGVjdGVkU2hlZXQgPSBuYW1lO1xyXG4gIH1cclxuXHJcbiAgb25GaWxlQ2hhbmdlKGV2ZW50OiBFdmVudCk6IHZvaWQge1xyXG4gICAgY29uc3QgZmlsZSA9IChldmVudC50YXJnZXQgYXMgSFRNTElucHV0RWxlbWVudCkuZmlsZXM/LlswXTtcclxuICAgIChldmVudC50YXJnZXQgYXMgSFRNTElucHV0RWxlbWVudCkudmFsdWUgPSAnJzsgXHJcbiAgICBpZiAoIWZpbGUpIHJldHVybjtcclxuXHJcbiAgICBjb25zdCByZWFkZXIgPSBuZXcgRmlsZVJlYWRlcigpO1xyXG4gICAgcmVhZGVyLm9ubG9hZCA9IChlOiBhbnkpID0+IHtcclxuICAgICAgY29uc3QgZGF0YSA9IG5ldyBVaW50OEFycmF5KGUudGFyZ2V0LnJlc3VsdCk7XHJcbiAgICAgIHRoaXMud29ya2Jvb2sgPSBYTFNYLnJlYWQoZGF0YSwgeyB0eXBlOiAnYXJyYXknIH0pO1xyXG5cclxuICAgICAgdGhpcy5zaGVldE5hbWVzID0gdGhpcy53b3JrYm9vay5TaGVldE5hbWVzID8/IFtdO1xyXG4gICAgICB0aGlzLnNlbGVjdGVkU2hlZXQgPSB0aGlzLnNoZWV0TmFtZXNbMF0gPz8gJyc7XHJcblxyXG4gICAgICBpZiAoIXRoaXMuc2VsZWN0ZWRTaGVldCkge1xyXG4gICAgICAgIHRoaXMuZXhjZWxEYXRhID0gW107XHJcbiAgICAgICAgcmV0dXJuO1xyXG4gICAgICB9XHJcbiAgICAgIHRoaXMubG9hZFNoZWV0KHRoaXMuc2VsZWN0ZWRTaGVldCk7XHJcbiAgICB9O1xyXG4gICAgcmVhZGVyLnJlYWRBc0FycmF5QnVmZmVyKGZpbGUpO1xyXG4gIH1cclxuXHJcbiAgbG9hZFNoZWV0KHNoZWV0TmFtZTogc3RyaW5nKTogdm9pZCB7XHJcbiAgICBpZiAoIXRoaXMud29ya2Jvb2spIHJldHVybjtcclxuICAgIGNvbnN0IHdzID0gdGhpcy53b3JrYm9vay5TaGVldHNbc2hlZXROYW1lXTtcclxuICAgIGNvbnN0IGFvYSA9IFhMU1gudXRpbHMuc2hlZXRfdG9fanNvbjxhbnlbXT4od3MsIHsgaGVhZGVyOiAxIH0pIGFzIGFueVtdW107XHJcbiAgICBjb25zdCBjbGVhbiA9IHRoaXMuc2FuaXRpemVBb2EoYW9hKTtcclxuICAgIGNvbnN0IHRyaW1tZWQgPSB0aGlzLnRyaW1MZWFkaW5nRW1wdHlSb3dzKGNsZWFuKTtcclxuICAgIHRoaXMuZXhjZWxEYXRhID0gKHRyaW1tZWQgJiYgdHJpbW1lZC5sZW5ndGgpID8gdHJpbW1lZCA6IFtbJyddXTtcclxuICB9XHJcblxyXG4gIG9uU2hlZXRDaGFuZ2UoZXZlbnQ6IEV2ZW50KTogdm9pZCB7XHJcbiAgICBjb25zdCBzaGVldCA9IChldmVudC50YXJnZXQgYXMgSFRNTFNlbGVjdEVsZW1lbnQpLnZhbHVlO1xyXG4gICAgdGhpcy5zZWxlY3RlZFNoZWV0ID0gc2hlZXQ7XHJcbiAgICB0aGlzLmxvYWRTaGVldChzaGVldCk7XHJcbiAgfVxyXG5cclxuICBkb3dubG9hZEV4Y2VsKCk6IHZvaWQge1xyXG4gICAgY29uc3Qgd2IgPSBYTFNYLnV0aWxzLmJvb2tfbmV3KCk7XHJcbiAgICBjb25zdCB3cyA9IFhMU1gudXRpbHMuYW9hX3RvX3NoZWV0KHRoaXMuZXhjZWxEYXRhKTtcclxuICAgIGNvbnN0IG5hbWUgPSB0aGlzLnNlbGVjdGVkU2hlZXQgfHwgdGhpcy5zaGVldE5hbWUgfHwgJ1NoZWV0MSc7XHJcbiAgICBYTFNYLnV0aWxzLmJvb2tfYXBwZW5kX3NoZWV0KHdiLCB3cywgbmFtZSk7XHJcblxyXG4gICAgY29uc3QgYnVmID0gWExTWC53cml0ZSh3YiwgeyBib29rVHlwZTogJ3hsc3gnLCB0eXBlOiAnYXJyYXknIH0pO1xyXG4gICAgY29uc3QgYmxvYiA9IG5ldyBCbG9iKFtidWZdLCB7IHR5cGU6ICdhcHBsaWNhdGlvbi9vY3RldC1zdHJlYW0nIH0pO1xyXG4gICAgc2F2ZUFzKGJsb2IsICd1cGRhdGVkX2V4Y2VsLnhsc3gnKTtcclxuICB9XHJcbn1cclxuXHJcbiIsIjxkaXYgY2xhc3M9XCJjb250YWluZXJcIj5cclxuICA8ZGl2IGNsYXNzPVwidXBsb2FkLXNlY3Rpb25cIiAqbmdJZj1cIiFoaWRlVXBsb2FkXCI+XHJcbiAgICA8bGFiZWwgZm9yPVwiZmlsZS11cGxvYWRcIiBjbGFzcz1cInVwbG9hZC1idG5cIj5VcGxvYWQgRXhjZWw8L2xhYmVsPlxyXG4gICAgPGlucHV0IHR5cGU9XCJmaWxlXCIgaWQ9XCJmaWxlLXVwbG9hZFwiIGFjY2VwdD1cIi54bHN4LC54bHMsLmNzdlwiIChjaGFuZ2UpPVwib25GaWxlQ2hhbmdlKCRldmVudClcIiBoaWRkZW4gLz5cclxuICAgIDxidXR0b24gY2xhc3M9XCJkb3dubG9hZC1idG5cIiAoY2xpY2spPVwiZG93bmxvYWRFeGNlbCgpXCIgW2Rpc2FibGVkXT1cIiFleGNlbERhdGEubGVuZ3RoXCI+RG93bmxvYWQgVXBkYXRlZCBFeGNlbDwvYnV0dG9uPlxyXG4gIDwvZGl2PlxyXG5cclxuICA8ZGl2ICpuZ0lmPVwic2hlZXROYW1lcy5sZW5ndGggPiAxXCIgY2xhc3M9XCJzaGVldC1zZWxlY3RvclwiPlxyXG4gICAgPGxhYmVsIGZvcj1cInNoZWV0U2VsZWN0XCI+U2VsZWN0IFNoZWV0OjwvbGFiZWw+XHJcbiAgICA8c2VsZWN0IGlkPVwic2hlZXRTZWxlY3RcIiAoY2hhbmdlKT1cIm9uU2hlZXRDaGFuZ2UoJGV2ZW50KVwiIFt2YWx1ZV09XCJzZWxlY3RlZFNoZWV0XCI+XHJcbiAgICAgIDxvcHRpb24gKm5nRm9yPVwibGV0IHNoZWV0IG9mIHNoZWV0TmFtZXNcIiBbdmFsdWVdPVwic2hlZXRcIj57eyBzaGVldCB9fTwvb3B0aW9uPlxyXG4gICAgPC9zZWxlY3Q+XHJcbiAgPC9kaXY+XHJcblxyXG4gIDxkaXYgKm5nSWY9XCJleGNlbERhdGEubGVuZ3RoID4gMFwiIGNsYXNzPVwiZXhjZWwtd3JhcHBlclwiIFtuZ1N0eWxlXT1cInsgd2lkdGg6IGNvbnRhaW5lcldpZHRoIH1cIj5cclxuICAgIDxkaXYgY2xhc3M9XCJleGNlbC10b29sYmFyXCI+XHJcbiAgICAgIDxidXR0b24gdHlwZT1cImJ1dHRvblwiIGNsYXNzPVwidGxiLWJ0blwiIHRpdGxlPVwiQm9sZFwiIChjbGljayk9XCJ0b2dnbGVCb2xkKClcIj48c3Ryb25nPkI8L3N0cm9uZz48L2J1dHRvbj5cclxuICAgICAgPGRpdiBjbGFzcz1cInRsYi1zZXBcIj48L2Rpdj5cclxuICAgICAgPGJ1dHRvbiB0eXBlPVwiYnV0dG9uXCIgY2xhc3M9XCJ0bGItYnRuXCIgdGl0bGU9XCJBbGlnbiBsZWZ0XCIgKGNsaWNrKT1cImFsaWduKCdsZWZ0JylcIj5MPC9idXR0b24+XHJcbiAgICAgIDxidXR0b24gdHlwZT1cImJ1dHRvblwiIGNsYXNzPVwidGxiLWJ0blwiIHRpdGxlPVwiQWxpZ24gY2VudGVyXCIgKGNsaWNrKT1cImFsaWduKCdjZW50ZXInKVwiPkM8L2J1dHRvbj5cclxuICAgICAgPGJ1dHRvbiB0eXBlPVwiYnV0dG9uXCIgY2xhc3M9XCJ0bGItYnRuXCIgdGl0bGU9XCJBbGlnbiByaWdodFwiIChjbGljayk9XCJhbGlnbigncmlnaHQnKVwiPlI8L2J1dHRvbj5cclxuICAgICAgPGRpdiBjbGFzcz1cInRsYi1zZXBcIj48L2Rpdj5cclxuICAgICAgPGJ1dHRvbiB0eXBlPVwiYnV0dG9uXCIgY2xhc3M9XCJ0bGItYnRuXCIgdGl0bGU9XCJXcmFwIHRleHRcIiAoY2xpY2spPVwidG9nZ2xlV3JhcCgpXCI+V3JhcDwvYnV0dG9uPlxyXG4gICAgICA8ZGl2IGNsYXNzPVwidGxiLXNlcFwiPjwvZGl2PlxyXG4gICAgICA8YnV0dG9uIHR5cGU9XCJidXR0b25cIiBjbGFzcz1cInRsYi1idG5cIiB0aXRsZT1cIkF1dG9TdW0gKEFsdCs9KVwiIChjbGljayk9XCJhZGRTdW1PdmVyU2VsZWN0aW9uKClcIj5TdW08L2J1dHRvbj5cclxuICAgICAgPGJ1dHRvbiB0eXBlPVwiYnV0dG9uXCIgY2xhc3M9XCJ0bGItYnRuXCIgdGl0bGU9XCJBdmVyYWdlXCIgKGNsaWNrKT1cImFkZEF2Z092ZXJTZWxlY3Rpb24oKVwiPkF2ZzwvYnV0dG9uPlxyXG4gICAgICA8YnV0dG9uIHR5cGU9XCJidXR0b25cIiBjbGFzcz1cInRsYi1idG5cIiB0aXRsZT1cIkNvdW50XCIgKGNsaWNrKT1cImFkZENvdW50T3ZlclNlbGVjdGlvbigpXCI+Q250PC9idXR0b24+XHJcbiAgICAgIDxkaXYgY2xhc3M9XCJ0bGItZ3Jvd1wiPjwvZGl2PlxyXG4gICAgICA8aW5wdXQgY2xhc3M9XCJuYW1lLWJveFwiIFt2YWx1ZV09XCJuYW1lQm94XCIgcmVhZG9ubHkgYXJpYS1sYWJlbD1cIkNlbGwgYWRkcmVzc1wiIC8+XG4gICAgICA8aW5wdXQgY2xhc3M9XCJmb3JtdWxhLWlucHV0XCIgWyhuZ01vZGVsKV09XCJmb3JtdWxhVGV4dFwiIChrZXl1cC5lbnRlcik9XCJhcHBseUZvcm11bGFCYXIoKVwiIChibHVyKT1cImFwcGx5Rm9ybXVsYUJhcigpXCIgcGxhY2Vob2xkZXI9XCJmeFwiIGFyaWEtbGFiZWw9XCJGb3JtdWxhIGJhclwiIC8+XG4gICAgICA8YnV0dG9uIHR5cGU9XCJidXR0b25cIiBjbGFzcz1cInRsYi1idG5cIiB0aXRsZT1cIkZpbmQgKEN0cmwrRilcIiAoY2xpY2spPVwib3BlbkZpbmRQYW5lbCgpXCI+RmluZDwvYnV0dG9uPlxuICAgICAgPGRpdiBjbGFzcz1cImZpbmQtcGFuZWxcIiAqbmdJZj1cInNob3dGaW5kXCI+XG4gICAgICAgIDxpbnB1dCAjZmluZElucHV0IGNsYXNzPVwiZmluZC1pbnB1dFwiIFsobmdNb2RlbCldPVwiZmluZFF1ZXJ5XCIgKGlucHV0KT1cInJ1bkZpbmQoKVwiIChrZXl1cC5lbnRlcik9XCJuZXh0RmluZCgpXCIgcGxhY2Vob2xkZXI9XCJGaW5kLi4uXCIgLz5cbiAgICAgICAgPGlucHV0IGNsYXNzPVwicmVwbGFjZS1pbnB1dFwiIFsobmdNb2RlbCldPVwicmVwbGFjZVRleHRcIiBwbGFjZWhvbGRlcj1cIlJlcGxhY2Ugd2l0aC4uLlwiIC8+XG4gICAgICAgIDxsYWJlbCBjbGFzcz1cImZpbmQtb3B0XCI+PGlucHV0IHR5cGU9XCJjaGVja2JveFwiIFsobmdNb2RlbCldPVwiZmluZENhc2VTZW5zaXRpdmVcIiAoY2hhbmdlKT1cInJ1bkZpbmQoKVwiIC8+IENhc2U8L2xhYmVsPlxuICAgICAgICA8c3BhbiBjbGFzcz1cImZpbmQtY291bnRcIj57eyBmaW5kUmVzdWx0cy5sZW5ndGggPyAoY3VycmVudEZpbmRJbmRleCArIDEpICsgJy8nICsgZmluZFJlc3VsdHMubGVuZ3RoIDogJzAvMCcgfX08L3NwYW4+XG4gICAgICAgIDxidXR0b24gdHlwZT1cImJ1dHRvblwiIGNsYXNzPVwidGxiLWJ0blwiIChjbGljayk9XCJwcmV2RmluZCgpXCI+UHJldjwvYnV0dG9uPlxuICAgICAgICA8YnV0dG9uIHR5cGU9XCJidXR0b25cIiBjbGFzcz1cInRsYi1idG5cIiAoY2xpY2spPVwibmV4dEZpbmQoKVwiPk5leHQ8L2J1dHRvbj5cbiAgICAgICAgPGJ1dHRvbiB0eXBlPVwiYnV0dG9uXCIgY2xhc3M9XCJ0bGItYnRuXCIgKGNsaWNrKT1cInJlcGxhY2VDdXJyZW50KClcIiBbZGlzYWJsZWRdPVwiIWZpbmRRdWVyeVwiPlJlcGxhY2U8L2J1dHRvbj5cbiAgICAgICAgPGJ1dHRvbiB0eXBlPVwiYnV0dG9uXCIgY2xhc3M9XCJ0bGItYnRuXCIgKGNsaWNrKT1cInJlcGxhY2VBbGxNYXRjaGVzKClcIiBbZGlzYWJsZWRdPVwiIWZpbmRRdWVyeVwiPlJlcGxhY2UgQWxsPC9idXR0b24+XG4gICAgICAgIDxidXR0b24gdHlwZT1cImJ1dHRvblwiIGNsYXNzPVwidGxiLWJ0blwiIChjbGljayk9XCJjbG9zZUZpbmRQYW5lbCgpXCI+Q2xvc2U8L2J1dHRvbj5cbiAgICAgIDwvZGl2PlxuICAgIDwvZGl2PlxuICAgIDxkaXYgY2xhc3M9XCJ0YWJsZS1jb250YWluZXJcIiBbbmdTdHlsZV09XCJ7IGhlaWdodDogY29udGFpbmVySGVpZ2h0IH1cIj5cbiAgICAgIDxob3QtdGFibGUgI2hvdFJlZiBbaG90SWRdPVwiaG90SWRcIiBjbGFzcz1cImhvdC1mdWxsXCJcbiAgICAgICAgW2RhdGFdPVwiZXhjZWxEYXRhXCIgW3Jvd0hlYWRlcnNdPVwidHJ1ZVwiIFtjb2xIZWFkZXJzXT1cInRydWVcIlxuICAgICAgICBbZHJvcGRvd25NZW51XT1cInRydWVcIiBbZmlsdGVyc109XCJ0cnVlXCIgW3NlYXJjaF09XCJ0cnVlXCJcbiAgICAgICAgW2NvbnRleHRNZW51XT1cImNvbnRleHRNZW51XCIgW2Zvcm11bGFzXT1cImZvcm11bGFzXCIgW2xpY2Vuc2VLZXldPVwibGljZW5zZUtleVwiXHJcbiAgICAgICAgW2NvcHlQYXN0ZV09XCJmYWxzZVwiXHJcbiAgICAgICAgW3N0cmV0Y2hIXT1cIidhbGwnXCIgW21hbnVhbENvbHVtblJlc2l6ZV09XCJ0cnVlXCIgW21hbnVhbFJvd1Jlc2l6ZV09XCJ0cnVlXCJcclxuICAgICAgICBbbWFudWFsQ29sdW1uTW92ZV09XCJ0cnVlXCIgW21hbnVhbFJvd01vdmVdPVwidHJ1ZVwiIFtjb2x1bW5Tb3J0aW5nXT1cInRydWVcIlxyXG4gICAgICAgIFtmaWxsSGFuZGxlXT1cInRydWVcIiBbZml4ZWRSb3dzVG9wXT1cImhlYWRlclJvd3NcIiBbZml4ZWRDb2x1bW5zTGVmdF09XCIwXCJcclxuICAgICAgICBbb3V0c2lkZUNsaWNrRGVzZWxlY3RzXT1cImZhbHNlXCIgW2N1cnJlbnRSb3dDbGFzc05hbWVdPVwiJ2N1cnJlbnRSb3cnXCJcclxuICAgICAgICBbY3VycmVudENvbENsYXNzTmFtZV09XCInY3VycmVudENvbCdcIj5cbiAgICAgIDwvaG90LXRhYmxlPlxuICAgIDwvZGl2PlxuICAgIDxkaXYgY2xhc3M9XCJzdGF0dXMtYmFyXCIgYXJpYS1saXZlPVwicG9saXRlXCI+XG4gICAgICA8bmctY29udGFpbmVyICpuZ0lmPVwiIXNlbGVjdGlvblN0YXRzLmhhc05vbk51bWVyaWMgJiYgc2VsZWN0aW9uU3RhdHMubnVtZXJpY0NvdW50ID4gMDsgZWxzZSBjb3VudE9ubHlcIj5cbiAgICAgICAgPGRpdiBjbGFzcz1cInN0YXR1cy1pdGVtXCI+XG4gICAgICAgICAgPHNwYW4gY2xhc3M9XCJzdGF0dXMtbGFiZWxcIj5BdmVyYWdlPC9zcGFuPlxuICAgICAgICAgIDxzcGFuIGNsYXNzPVwic3RhdHVzLXZhbHVlXCI+e3sgc2VsZWN0aW9uU3RhdHMuYXZlcmFnZSAhPT0gbnVsbCA/IChzZWxlY3Rpb25TdGF0cy5hdmVyYWdlIHwgbnVtYmVyOicxLjAtNCcpIDogJ+KAlCcgfX08L3NwYW4+XG4gICAgICAgIDwvZGl2PlxuICAgICAgICA8ZGl2IGNsYXNzPVwic3RhdHVzLWl0ZW1cIj5cbiAgICAgICAgICA8c3BhbiBjbGFzcz1cInN0YXR1cy1sYWJlbFwiPkNvdW50PC9zcGFuPlxuICAgICAgICAgIDxzcGFuIGNsYXNzPVwic3RhdHVzLXZhbHVlXCI+e3sgc2VsZWN0aW9uU3RhdHMuY291bnQgfX08L3NwYW4+XG4gICAgICAgIDwvZGl2PlxuICAgICAgICA8ZGl2IGNsYXNzPVwic3RhdHVzLWl0ZW1cIj5cbiAgICAgICAgICA8c3BhbiBjbGFzcz1cInN0YXR1cy1sYWJlbFwiPlN1bTwvc3Bhbj5cbiAgICAgICAgICA8c3BhbiBjbGFzcz1cInN0YXR1cy12YWx1ZVwiPnt7IHNlbGVjdGlvblN0YXRzLm51bWVyaWNDb3VudCA/IChzZWxlY3Rpb25TdGF0cy5zdW0gfCBudW1iZXI6JzEuMC00JykgOiAn4oCUJyB9fTwvc3Bhbj5cbiAgICAgICAgPC9kaXY+XG4gICAgICA8L25nLWNvbnRhaW5lcj5cbiAgICAgIDxuZy10ZW1wbGF0ZSAjY291bnRPbmx5PlxuICAgICAgICA8ZGl2IGNsYXNzPVwic3RhdHVzLWl0ZW1cIj5cbiAgICAgICAgICA8c3BhbiBjbGFzcz1cInN0YXR1cy1sYWJlbFwiPkNvdW50PC9zcGFuPlxuICAgICAgICAgIDxzcGFuIGNsYXNzPVwic3RhdHVzLXZhbHVlXCI+e3sgc2VsZWN0aW9uU3RhdHMuY291bnQgfX08L3NwYW4+XG4gICAgICAgIDwvZGl2PlxuICAgICAgPC9uZy10ZW1wbGF0ZT5cbiAgICA8L2Rpdj5cbiAgPC9kaXY+XG48L2Rpdj5cbiJdfQ==