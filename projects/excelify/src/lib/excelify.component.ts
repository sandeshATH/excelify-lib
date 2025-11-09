import { Component, Input, OnChanges, SimpleChanges, ViewChild, AfterViewInit, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HotTableModule, HotTableComponent, HotTableRegisterer } from '@handsontable/angular';
import Handsontable from 'handsontable';
import { HyperFormula } from 'hyperformula';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'eq-excelify',
  standalone: true,
  imports: [CommonModule, HotTableModule, FormsModule],
  templateUrl: './excelify.component.html',
  styleUrls: ['./excelify.component.scss'],
})
export class ExcelifyComponent implements AfterViewInit {
  excelData: any[][] = [];

  @Input() griddata: any;

  private workbook?: XLSX.WorkBook;
  sheetNames: string[] = [];
  selectedSheet = '';

  // HyperFormula engine instance (REQUIRED for formulas)
  private hf = HyperFormula.buildEmpty({ licenseKey: 'gpl-v3' });
  formulas: any = { engine: this.hf };
// @ts-ignore
  // Show insert/delete row/col etc. in context menu
  contextMenu: Handsontable.contextMenu.Settings['items'] | boolean = [
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

  @Input() data?: any[];
  @Input() columns?: { field: string; header?: string }[];
  @Input() sheetName?: string;
  @Input() hideUpload = false;
  // Exclude columns by field or header text (case-insensitive)
  @Input() excludeColumns: string[] = [];
  // Constrained container size (customizable by parent)
  @Input() containerHeight: string = '70vh';
  @Input() containerWidth: string = '100%';
  // Number of top rows to treat as headers (not sortable)
  @Input() headerRows: number = 1;
  
  @ViewChild('hotRef', { static: false }) hotComponent?: HotTableComponent;
  private hot?: Handsontable;
  private hotRegisterer = new HotTableRegisterer();
  hotId = 'excelifyHot';
  selectedRow = 0;
  selectedCol = 0;
  nameBox = 'A1';
  formulaText = '';
  selectionStats: { sum: number; average: number | null; numericCount: number; count: number; hasNonNumeric: boolean } = {
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
  findResults: { row: number; col: number }[] = [];
  currentFindIndex = 0;
  @ViewChild('findInput') findInput?: ElementRef<HTMLInputElement>;
  private lastSelection: { r1: number; c1: number; r2: number; c2: number } | null = null;
  replaceText = '';

  ngAfterViewInit(): void {
    this.hot = this.hotRegisterer.getInstance(this.hotId) as Handsontable | undefined;
    if (!this.hot) {
      this.hot = (this.hotComponent as any)?.hotInstance as Handsontable | undefined;
    }
    if (this.hot) {
      this.hot.addHook('afterSelection', (r: number, c: number, r2?: number, c2?: number) => {
        this.handleSelectionChange(r, c, r2, c2);
      });
      this.hot.addHook('afterSelectionEnd', (r: number, c: number, r2?: number, c2?: number) => {
        this.handleSelectionChange(r, c, r2, c2);
      });
      this.hot.addHook('afterOnCellMouseDown', () => this.syncSelectionFromLastRange());
      this.hot.addHook('afterOnCellMouseUp', () => this.syncSelectionFromLastRange());
      this.hot.addHook('afterChange', () => {
        this.updateSelection(this.selectedRow, this.selectedCol);
      });
      // Alt+= autosum shortcut, Ctrl/Cmd+F open Find, Esc close Find
      this.hot.addHook('beforeKeyDown', (e: KeyboardEvent) => {
        if (!e) return;
        const key = (e as any).key as string;
        const code = (e as any).code as string;
        // Block copy/cut shortcuts inside the grid
        const isCtrlLike = (e as any).ctrlKey || (e as any).metaKey;
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
        if ((e as any).altKey && (key === '=' || code === 'Equal')) {
          e.preventDefault();
          this.addSumOverSelection();
          return;
        }
        if (((e as any).ctrlKey || (e as any).metaKey) && (key?.toLowerCase() === 'f')) {
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
      this.hot.addHook('beforeColumnSort', (_currentCfg: any, destinationCfg: any) => {
        const cfg = Array.isArray(destinationCfg) ? destinationCfg[0] : destinationCfg;
        if (!cfg || cfg.column == null) return; // allow default if unknown
        const colIndex = typeof cfg.column === 'number' ? cfg.column : (cfg.column?.visualIndex ?? cfg.column);
        const order: 'asc' | 'desc' = (cfg.sortOrder === 'desc') ? 'desc' : 'asc';
        try {
          this.sortDataPreservingHeader(colIndex, order);
        } catch (e) {
          console.warn('Custom sort failed, falling back to default', e);
          return; // default will proceed
        }
        return false; // cancel default sorting since we applied our own
      });
    }
  }

  // Sorts rows below `headerRows` by the given column, keeping header rows unchanged
  private sortDataPreservingHeader(colIndex: number, order: 'asc' | 'desc') {
    const data = this.excelData || [];
    const headerCount = Math.max(0, Math.min(this.headerRows, data.length));
    if (data.length <= headerCount) return;
    const head = data.slice(0, headerCount);
    const body = data.slice(headerCount);
    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
    const cmp = (a: any, b: any) => {
      const va = a?.[colIndex];
      const vb = b?.[colIndex];
      if (va == null && vb == null) return 0;
      if (va == null) return 1; // nulls last
      if (vb == null) return -1;
      const na = typeof va === 'number' ? va : Number(va);
      const nb = typeof vb === 'number' ? vb : Number(vb);
      let res: number;
      if (!Number.isNaN(na) && !Number.isNaN(nb)) res = na - nb; else res = collator.compare(String(va), String(vb));
      return order === 'asc' ? res : -res;
    };
    body.sort(cmp);
    this.excelData = [...head, ...body];
    // Ensure Handsontable re-renders with updated data
    setTimeout(() => this.hot?.render());
  }

  private colToLetter(col: number): string {
    let s = '';
    let n = col + 1;
    while (n > 0) {
      const mod = (n - 1) % 26;
      s = String.fromCharCode(65 + mod) + s;
      n = Math.floor((n - mod) / 26);
    }
    return s;
  }

  private handleSelectionChange(r1: number, c1: number, r2?: number, c2?: number) {
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

  private updateSelection(row: number, col: number) {
    this.selectedRow = row;
    this.selectedCol = col;
    this.nameBox = `${this.colToLetter(col)}${row + 1}`;
    const src = this.hot?.getSourceDataAtCell(row, col) as any;
    this.formulaText = src == null ? '' : String(src);
    this.recalculateSelectionStats();
  }

  private syncSelectionFromLastRange() {
    if (!this.hot) return;
    // @ts-ignore - depending on HOT version this may not be typed
    const range = this.hot.getSelectedRangeLast?.();
    if (!range) return;
    this.handleSelectionChange(range.from.row, range.from.col, range.to.row, range.to.col);
  }

  private recalculateSelectionStats() {
    if (!this.hot) {
      this.selectionStats = { sum: 0, average: null, numericCount: 0, count: 0, hasNonNumeric: false };
      return;
    }
    let sum = 0;
    let numericCount = 0;
    let populatedCount = 0;
    let hasNonNumeric = false;
    this.forEachCellInSelection((r, c) => {
      if (r == null || c == null) return;
      const val = this.hot!.getDataAtCell(r, c);
      if (!this.isValueEmpty(val)) populatedCount++;
      const numeric = this.coerceToNumber(val);
      if (numeric != null) {
        sum += numeric;
        numericCount++;
      } else if (!this.isValueEmpty(val)) {
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

  private coerceToNumber(value: any): number | null {
    if (value === '' || value === null || value === undefined) return null;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private isValueEmpty(value: any): boolean {
    if (value === null || value === undefined) return true;
    if (typeof value === 'string') return value.trim() === '';
    return false;
  }

  applyFormulaBar() {
    if (!this.hot) return;
    this.hot.setDataAtCell(this.selectedRow, this.selectedCol, this.formulaText);
  }

  // ===== Excel-like toolbar actions =====
  private forEachCellInSelection(cb: (r: number, c: number) => void) {
    if (!this.hot) return;
    // @ts-ignore - getSelectedRange may be typed loosely depending on version
    const ranges = this.hot.getSelectedRange?.() || [];
    if (ranges.length) {
      ranges.forEach((range: any) => {
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

  private updateClassOnSelection(addClasses: string[] = [], removeClasses: string[] = []) {
    if (!this.hot) return;
    const addSet = new Set(addClasses.filter(Boolean));
    const removeSet = new Set(removeClasses.filter(Boolean));
    this.forEachCellInSelection((r, c) => {
      const meta = this.hot!.getCellMeta(r, c) as any;
      const existing = (meta.className || '').split(/\s+/).filter(Boolean);
      let set = new Set(existing);
      removeSet.forEach(cls => set.delete(cls));
      addSet.forEach(cls => set.add(cls));
      const next = Array.from(set).join(' ');
      this.hot!.setCellMeta(r, c, 'className', next);
    });
    this.hot.render();
  }

  toggleBold() {
    if (!this.hot) return;
    // Simple toggle: if first cell has htBold then remove, else add
    const meta = this.hot.getCellMeta(this.selectedRow, this.selectedCol) as any;
    const has = (meta.className || '').split(/\s+/).includes('htBold');
    if (has) this.updateClassOnSelection([], ['htBold']); else this.updateClassOnSelection(['htBold']);
  }

  align(where: 'left' | 'center' | 'right') {
    const map: any = { left: 'htLeft', center: 'htCenter', right: 'htRight' };
    this.updateClassOnSelection([map[where]], ['htLeft', 'htCenter', 'htRight']);
  }

  toggleWrap() {
    if (!this.hot) return;
    const meta = this.hot.getCellMeta(this.selectedRow, this.selectedCol) as any;
    const has = (meta.className || '').split(/\s+/).includes('htWrap');
    if (has) this.updateClassOnSelection([], ['htWrap']); else this.updateClassOnSelection(['htWrap']);
  }

  // ===== Quick functions based on current selection =====
  private getFirstSelectionRange() {
    // @ts-ignore
    const ranges = this.hot?.getSelectedRange?.();
    if (!ranges || !ranges.length) return null;
    const r = ranges[0];
    const r1 = Math.min(r.from.row, r.to.row);
    const r2 = Math.max(r.from.row, r.to.row);
    const c1 = Math.min(r.from.col, r.to.col);
    const c2 = Math.max(r.from.col, r.to.col);
    return { r1, r2, c1, c2 };
  }

  private rangeToA1(r1: number, c1: number, r2: number, c2: number) {
    const start = `${this.colToLetter(c1)}${r1 + 1}`;
    const end = `${this.colToLetter(c2)}${r2 + 1}`;
    return r1 === r2 && c1 === c2 ? start : `${start}:${end}`;
  }

  addSumOverSelection() {
    const sel = this.getFirstSelectionRange();
    if (!sel) return;
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
    if (!sel) return;
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
    if (!sel) return;
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
  private buildSumArgsExcludingActive(r1: number, c1: number, r2: number, c2: number, ar: number, ac: number): string {
    const parts: string[] = [];
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
    if (!this.hot) return;
    // Use search plugin
    // @ts-ignore
    const search = this.hot.getPlugin('search');
    const query = this.findQuery || '';
    const cmp = (q: string, value: any) => {
      if (!q) return false;
      const val = value == null ? '' : String(value);
      if (this.findCaseSensitive) return val.indexOf(q) !== -1;
      return val.toLowerCase().indexOf(q.toLowerCase()) !== -1;
    };
    const results = search.query(query, undefined, (qStr: string, value: any) => cmp(qStr, value)) || [];
    this.findResults = results.map((r: any) => ({ row: r.row, col: r.col }));
    this.currentFindIndex = 0;
    if (this.findResults.length) this.gotoFindIndex(0);
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
  gotoFindIndex(idx: number) {
    if (!this.hot || !this.findResults.length) return;
    const n = this.findResults.length;
    this.currentFindIndex = ((idx % n) + n) % n; // wrap
    const { row, col } = this.findResults[this.currentFindIndex];
    this.hot.selectCell(row, col, row, col, true, true);
    this.updateSelection(row, col);
  }
  nextFind() { this.gotoFindIndex(this.currentFindIndex + 1); }
  prevFind() { this.gotoFindIndex(this.currentFindIndex - 1); }

  replaceCurrent() {
    if (!this.hot || !this.findQuery) return;
    if (!this.findResults.length) {
      this.runFind();
      if (!this.findResults.length) return;
    }
    const { row, col } = this.findResults[this.currentFindIndex];
    const currentValue = this.hot.getDataAtCell(row, col);
    const next = this.buildReplacement(String(currentValue ?? ''), false);
    if (next === null) return;
    this.hot.setDataAtCell(row, col, next);
    this.hot.render();
    this.runFind();
  }

  replaceAllMatches() {
    if (!this.hot || !this.findQuery) return;
    const rows = this.hot.countRows?.() ?? 0;
    const cols = this.hot.countCols?.() ?? 0;
    if (!rows || !cols) return;
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

  private buildReplacement(value: string, allOccurrences: boolean): string | null {
    const query = this.findQuery;
    if (!query) return null;
    const flags = this.findCaseSensitive ? '' : 'i';
    const escaped = this.escapeRegExp(query);
    const re = new RegExp(escaped, allOccurrences ? `g${flags}` : flags);
    if (!re.test(value)) return null;
    re.lastIndex = 0; // reset for reuse
    return value.replace(re, this.replaceText ?? '');
  }

  private escapeRegExp(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  
  // Ensure cells are primitives acceptable by Handsontable/HyperFormula
  private sanitizeCell(value: any): string | number | boolean | null {
    if (value === null || value === undefined) return '';
    if (Array.isArray(value)) return value.join(', ');
    const t = typeof value;
    if (t === 'string' || t === 'number' || t === 'boolean') return value as any;
    if (value instanceof Date) return value.toISOString();
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  private sanitizeAoa(aoa: any[][]): (string | number | boolean | null)[][] {
    return (aoa || []).map(row => Array.isArray(row) ? row.map(c => this.sanitizeCell(c)) : [this.sanitizeCell(row)]);
  }

  // Remove leading entirely empty rows so the header is at the very top
  private trimLeadingEmptyRows(aoa: (string | number | boolean | null)[][]): (string | number | boolean | null)[][] {
    const isEmpty = (v: any) => v === '' || v === null || v === undefined;
    let start = 0;
    while (start < (aoa?.length || 0)) {
      const row = aoa[start] || [];
      if (row.some(cell => !isEmpty(cell))) break;
      start++;
    }
    return (aoa || []).slice(start);
  }

  
  ngOnChanges(changes: SimpleChanges): void {
    if (changes['data'] || changes['columns'] || changes['sheetName']) {
      console.log('changes', changes)
      if (Array.isArray(this.data) && this.data.length > 0) {
        this.setSheetFromObjects(this.data, this.columns, this.sheetName || 'Sheet1');
      } else if (Array.isArray(this.data) && this.data.length === 0) {
        // If explicitly passed empty data, clear the table
        this.excelData = [];
        this.workbook = undefined;
        this.sheetNames = [];
        this.selectedSheet = '';
      }
    }
  }

  setSheetFromObjects(rows: any[], cols?: { field: string; header?: string }[], name: string = 'Sheet1') {
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

  onFileChange(event: Event): void {
    const file = (event.target as HTMLInputElement).files?.[0];
    (event.target as HTMLInputElement).value = ''; 
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e: any) => {
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

  loadSheet(sheetName: string): void {
    if (!this.workbook) return;
    const ws = this.workbook.Sheets[sheetName];
    const aoa = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1 }) as any[][];
    const clean = this.sanitizeAoa(aoa);
    const trimmed = this.trimLeadingEmptyRows(clean);
    this.excelData = (trimmed && trimmed.length) ? trimmed : [['']];
  }

  onSheetChange(event: Event): void {
    const sheet = (event.target as HTMLSelectElement).value;
    this.selectedSheet = sheet;
    this.loadSheet(sheet);
  }

  downloadExcel(): void {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(this.excelData);
    const name = this.selectedSheet || this.sheetName || 'Sheet1';
    XLSX.utils.book_append_sheet(wb, ws, name);

    const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([buf], { type: 'application/octet-stream' });
    saveAs(blob, 'updated_excel.xlsx');
  }
}

