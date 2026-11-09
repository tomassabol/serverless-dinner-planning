import { z } from 'zod';

export const COUNTRIES = {
  DK: { name: 'Denmark', adjective: 'Danish', language: 'Danish', currency: 'DKK', locale: 'da-DK', timeZone: 'Europe/Copenhagen' },
  SE: { name: 'Sweden', adjective: 'Swedish', language: 'Swedish', currency: 'SEK', locale: 'sv-SE', timeZone: 'Europe/Stockholm' },
} as const;

export const CountrySchema = z.enum(['DK', 'SE']);
export type Country = z.infer<typeof CountrySchema>;

export const CurrencySchema = z.enum(['DKK', 'SEK']);
export type Currency = z.infer<typeof CurrencySchema>;

export const countryInfo = (country: Country) => COUNTRIES[country];
