import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ExcelifyComponent } from './excelify.component';

describe('ExcelifyComponent', () => {
  let component: ExcelifyComponent;
  let fixture: ComponentFixture<ExcelifyComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ExcelifyComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(ExcelifyComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
