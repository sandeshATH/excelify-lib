# Excelify

Handsontable-powered Excel UI that lets you upload, edit, find/replace, format, and download spreadsheets entirely inside Angular.

## Features
- Upload `.xlsx`, `.xls`, and `.csv` files and pick sheets to edit.
- Excel-style toolbar (bold, alignment, wrapping, AutoSum/Average/Count).
- Status bar that mirrors Excel's Sum/Average/Count logic.
- Built-in find and replace panel with case sensitivity support.
- Formula bar backed by HyperFormula so spreadsheet formulas continue to work.
- Download the edited workbook back to disk.

## Installation

```bash
npm install @devath/excelify \
  @handsontable/angular handsontable hyperformula \
  file-saver xlsx
```

> The package lists Angular, Handsontable, HyperFormula, FileSaver, and XLSX as peer dependencies so your app controls versions.

Register the Handsontable styles once (e.g. in `angular.json` or a global style):

```json
"styles": [
  "node_modules/handsontable/dist/handsontable.full.min.css",
  "src/styles.scss"
]
```

## Usage

```ts
import { ExcelifyModule } from '@devath/excelify';

@NgModule({
  imports: [ExcelifyModule],
})
export class AppModule {}
```

```html
<eq-excelify
  [data]="tableData"
  [columns]="columns"
  [sheetName]="'Sheet1'"
  [excludeColumns]="['internalId']"
  [containerHeight]="'75vh'">
</eq-excelify>
```

### Inputs

| Input | Type | Description |
| --- | --- | --- |
| `data` | `any[]` | Optional array of objects to seed the grid. |
| `columns` | `{ field: string; header?: string }[]` | Optional column definitions when supplying data. |
| `sheetName` | `string` | Name of the initial worksheet to show when uploading multi-sheet files. |
| `hideUpload` | `boolean` | Hide the upload/download toolbar (defaults to `false`). |
| `excludeColumns` | `string[]` | Case-insensitive list of column field/headers to omit when generating sheets. |
| `containerHeight` / `containerWidth` | `string` | Dimensions for the Handsontable container. |
| `headerRows` | `number` | Number of locked header rows when sorting. |

The component is standalone, so you can also import it directly if you prefer:

```ts
import { ExcelifyComponent } from '@devath/excelify';



