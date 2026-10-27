/**
 * Builds data/frida-foods.json from the Frida workbook published by DTU Food (CC BY 4.0).
 * Download Frida_<version>_Dataset.xlsx from https://doi.org/10.11583/DTU.29500682, then:
 *   pnpm --filter @dinner/tools build:frida <path-to-xlsx>
 */
import { writeFile } from 'node:fs/promises';
import ExcelJS from 'exceljs';
import type { FridaFood } from '../src/nutrition.js';

/** Frida ParameterID → field on FridaFood.per100g. */
const PARAMETERS: Record<number, keyof FridaFood['per100g']> = {
  356: 'kcal',
  218: 'protein',
  141: 'fat',
  248: 'saturatedFat',
  172: 'carbs',
  245: 'sugars',
  168: 'fiber',
  327: 'salt',
};

const path = process.argv[2];
if (!path) throw new Error('Usage: build-frida.ts <Frida_Dataset.xlsx>');

const workbook = new ExcelJS.Workbook();
await workbook.xlsx.readFile(path);

const cell = (values: unknown[], index: number) => {
  const value = values[index];
  return value === null || value === undefined || value === 'NULL' ? undefined : value;
};

const foods = new Map<number, FridaFood>();
workbook.getWorksheet('Food')!.eachRow((row, rowNumber) => {
  if (rowNumber === 1) return;
  const v = row.values as unknown[];
  const id = Number(cell(v, 3));
  foods.set(id, {
    id,
    nameDa: String(cell(v, 1) ?? '').trim(),
    nameEn: String(cell(v, 2) ?? '').trim(),
    group: String(cell(v, 13) ?? '').trim(),
    per100g: { kcal: 0, protein: 0, fat: 0, saturatedFat: 0, carbs: 0, sugars: 0, fiber: 0, salt: 0 },
  });
});

workbook.getWorksheet('Data_Normalised')!.eachRow((row, rowNumber) => {
  if (rowNumber === 1) return;
  const v = row.values as unknown[];
  const field = PARAMETERS[Number(cell(v, 4))];
  const food = foods.get(Number(cell(v, 1)));
  const value = Number(cell(v, 8));
  if (field && food && Number.isFinite(value)) food.per100g[field] = Math.round(value * 10) / 10;
});

const result = [...foods.values()].filter((f) => f.nameEn && f.per100g.kcal > 0).sort((a, b) => a.id - b.id);
const out = new URL('../data/frida-foods.json', import.meta.url);
await writeFile(out, JSON.stringify(result));
console.log(`Wrote ${result.length} foods to ${out.pathname}`);
