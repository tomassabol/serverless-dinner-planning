import type { StoredPlan } from '@dinner/shared';

const LONG_DAY = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'UTC' });
const SHORT_DAY = new Intl.DateTimeFormat('en-GB', { weekday: 'short', timeZone: 'UTC' });
const day = (date: string, format = LONG_DAY) => format.format(new Date(`${date}T12:00:00Z`));
const dkk = (n: number) => `${n.toFixed(2).replace('.', ',').replace(',00', '')} kr`;

const COLORS = {
  page: '#f4f1ec',
  card: '#ffffff',
  ink: '#1f2a24',
  muted: '#6b7280',
  accent: '#2f6b4f',
  accentSoft: '#e7f0ea',
  rule: '#e5e1da',
};

export function renderPlanEmail(plan: StoredPlan): { subject: string; html: string; text: string } {
  const weekNumber = plan.week.split('-W')[1]?.replace(/^0/, '');
  const dishes = plan.dinners.map((d) => d.dish.split(/ with | med /i)[0]);
  const subject = truncate(`Week ${weekNumber} dinners: ${dishes.join(', ')}`, 120);

  // Which store sells each offer, for the ingredient lists.
  const storeByOffer = new Map(plan.shoppingList.stores.flatMap((s) => s.items.map((i) => [i.offerId, s.chainName] as const)));

  const first = plan.dinners[0]?.date;
  const last = plan.dinners.at(-1)?.date;
  const range = first && last ? `${day(first)} – ${day(last)}` : '';

  const dinnerCards = plan.dinners
    .map((d) => {
      const ingredients = d.ingredients
        .map((i) => {
          const store = i.offerId ? storeByOffer.get(i.offerId) : undefined;
          return `<li style="margin:0 0 4px">${esc(i.name)} <span style="color:${COLORS.muted}">${i.grams} g</span>${
            store ? ` <span style="background:${COLORS.accentSoft};color:${COLORS.accent};border-radius:4px;padding:1px 6px;font-size:12px">${esc(store)} offer</span>` : ''
          }</li>`;
        })
        .join('');
      const steps = d.steps.map((s) => `<li style="margin:0 0 6px">${esc(s)}</li>`).join('');
      const image = d.imageUrl
        ? `<img src="${esc(d.imageUrl)}" width="600" alt="${esc(d.dish)}" style="display:block;width:100%;max-width:600px;height:auto;border-radius:12px 12px 0 0">`
        : '';
      return `
<tr><td style="padding:0 0 24px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COLORS.card};border-radius:12px;border:1px solid ${COLORS.rule}">
    <tr><td>${image}</td></tr>
    <tr><td style="padding:20px 24px 24px">
      <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:${COLORS.accent};font-weight:600">${esc(day(d.date))}</div>
      <h2 style="margin:6px 0 8px;font-size:22px;line-height:1.25;color:${COLORS.ink}">${esc(d.dish)}</h2>
      <p style="margin:0 0 12px;color:${COLORS.ink};line-height:1.5">${esc(d.description)}</p>
      <p style="margin:0 0 16px;color:${COLORS.muted};font-size:14px">${d.cookingMinutes} min · ${esc(d.cuisine)} · ${d.nutrition.kcal} kcal · ${d.nutrition.protein} g protein · ${d.nutrition.fiber} g fibre per serving · ~${dkk(d.estimatedCostDkk)}</p>
      <h3 style="margin:0 0 8px;font-size:15px;color:${COLORS.ink}">Ingredients <span style="font-weight:400;color:${COLORS.muted}">(${d.servings} servings)</span></h3>
      <ul style="margin:0 0 16px;padding-left:20px;color:${COLORS.ink};font-size:14px">${ingredients}</ul>
      <h3 style="margin:0 0 8px;font-size:15px;color:${COLORS.ink}">How to make it</h3>
      <ol style="margin:0;padding-left:20px;color:${COLORS.ink};font-size:14px;line-height:1.5">${steps}</ol>
    </td></tr>
  </table>
</td></tr>`;
    })
    .join('');

  const stores = plan.shoppingList.stores
    .map(
      (s) => `
<h3 style="margin:16px 0 8px;font-size:16px;color:${COLORS.ink}">${esc(s.chainName)} <span style="font-weight:400;color:${COLORS.muted}">· ${dkk(s.subtotal)}</span></h3>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;color:${COLORS.ink}">
${s.items
  .map(
    (i) => `<tr>
  <td style="padding:6px 0;border-bottom:1px solid ${COLORS.rule}">${esc(i.heading)}<br><span style="color:${COLORS.muted};font-size:12px">for ${i.forDinners.map((d) => day(d, SHORT_DAY)).join(', ')} · until ${day(i.validTo.slice(0, 10), SHORT_DAY)} ${i.validTo.slice(8, 10)}/${i.validTo.slice(5, 7)}</span></td>
  <td style="padding:6px 0;border-bottom:1px solid ${COLORS.rule};text-align:right;white-space:nowrap;vertical-align:top">${dkk(i.price)}${i.prePrice ? `<br><s style="color:${COLORS.muted};font-size:12px">${dkk(i.prePrice)}</s>` : ''}</td>
</tr>`,
  )
  .join('')}
</table>`,
    )
    .join('');

  const other = plan.shoppingList.other.length
    ? `<h3 style="margin:20px 0 8px;font-size:16px;color:${COLORS.ink}">Also needed <span style="font-weight:400;color:${COLORS.muted}">· check your pantry first</span></h3>
<p style="margin:0;color:${COLORS.ink};font-size:14px;line-height:1.7">${plan.shoppingList.other.map((o) => `${esc(o.name)} <span style="color:${COLORS.muted}">${o.grams} g</span>`).join(' · ')}</p>`
    : '';

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:${COLORS.page};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COLORS.page}"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px">
  <tr><td style="padding:8px 4px 24px">
    <div style="font-size:13px;color:${COLORS.muted}">Week ${esc(weekNumber ?? plan.week)} · ${esc(range)}</div>
    <h1 style="margin:6px 0 12px;font-size:28px;line-height:1.2;color:${COLORS.ink}">What's for dinner this week</h1>
    <p style="margin:0;font-size:16px;line-height:1.55;color:${COLORS.ink}">${esc(plan.verdict.summary)}</p>
    <p style="margin:12px 0 0;font-size:13px;color:${COLORS.muted}">Reviewed ${plan.verdict.score}/10 · about ${dkk(plan.shoppingList.offerTotal)} on offers</p>
  </td></tr>
  ${dinnerCards}
  <tr><td style="padding:0 0 24px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COLORS.card};border-radius:12px;border:1px solid ${COLORS.rule}"><tr><td style="padding:20px 24px 24px">
      <h2 style="margin:0 0 4px;font-size:20px;color:${COLORS.ink}">Shopping list</h2>
      <p style="margin:0;color:${COLORS.muted};font-size:14px">Offers grouped by store, ${dkk(plan.shoppingList.offerTotal)} in total.</p>
      ${stores}
      ${other}
    </td></tr></table>
  </td></tr>
  <tr><td style="padding:0 4px 24px;font-size:12px;line-height:1.5;color:${COLORS.muted}">
    Planned by your dinner agents from this week's Danish supermarket offers. Nutrition per serving is calculated with Frida, the Danish Food Composition Database (DTU Food, CC BY 4.0). Meal photos are AI-generated illustrations.
  </td></tr>
</table>
</td></tr></table>
</body></html>`;

  const text = [
    `Week ${weekNumber} · ${range}`,
    '',
    plan.verdict.summary,
    '',
    ...plan.dinners.flatMap((d) => [
      `${day(d.date).toUpperCase()}: ${d.dish}`,
      `${d.cookingMinutes} min · ${d.nutrition.kcal} kcal · ${d.nutrition.protein} g protein per serving`,
      `Ingredients: ${d.ingredients.map((i) => `${i.name} ${i.grams} g`).join(', ')}`,
      ...d.steps.map((s, i) => `${i + 1}. ${s}`),
      '',
    ]),
    'SHOPPING LIST',
    ...plan.shoppingList.stores.flatMap((s) => [
      `${s.chainName} (${dkk(s.subtotal)})`,
      ...s.items.map((i) => `- ${i.heading}: ${dkk(i.price)}`),
    ]),
    plan.shoppingList.other.length ? `Also needed: ${plan.shoppingList.other.map((o) => `${o.name} ${o.grams} g`).join(', ')}` : '',
    '',
    'Nutrition: Frida, Danish Food Composition Database (DTU Food, CC BY 4.0). Photos are AI-generated.',
  ].join('\n');

  return { subject, html, text };
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const truncate = (s: string, max: number) => (s.length <= max ? s : `${s.slice(0, max - 1)}…`);
