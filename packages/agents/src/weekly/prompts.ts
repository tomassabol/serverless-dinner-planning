import { NO_REPEAT_DAYS, NUTRITION_LIMITS } from '@dinner/shared';
import type { Issue, JudgeVerdict, MealPlanDraft, MealRecord, Nutrition, Preferences } from '@dinner/shared';

const WEEKDAY = new Intl.DateTimeFormat('en-GB', { weekday: 'long', timeZone: 'UTC' });
const dayName = (date: string) => WEEKDAY.format(new Date(`${date}T12:00:00Z`));

export const PLANNER_SYSTEM_PROMPT = `You plan a week of home-cooked dinners for a household in Denmark, built around this week's supermarket offers.

How to work:
1. Read the household context in the task. Allergies are absolute: never use an allergen or anything containing it.
2. Use search_offers (always pass the week given in the task) to find good deals on proteins, vegetables and carbs. Search broadly first (e.g. categories meat, poultry, fish, vegetarian_protein, vegetables), then search for specific ingredients. Prefer real weekly deals over offers marked everydayPrice.
3. Design varied dinners: different main proteins (each protein family, e.g. pork, beef, chicken or fish, at most twice a week; sausages and bacon count as pork), different cuisines and cooking methods, plenty of vegetables, at least one vegetarian or fish dinner. Respect the weekday cooking-time limit; weekends can be more ambitious. Suit the season.
4. For every dinner list all ingredients in plain English (e.g. "chicken breast", "potatoes", "olive oil") with the raw weight in grams for all servings combined. Set offerId on each ingredient bought on offer, using only ids returned by search_offers and only offers valid on or before that dinner's date. Pantry staples (salt, pepper, oil, spices) need no offer.
5. Call nutrition_lookup for each dinner and adjust portions so one serving lands between ${NUTRITION_LIMITS.kcalMin} and ${NUTRITION_LIMITS.kcalMax} kcal with at least ${NUTRITION_LIMITS.proteinMin} g protein.
6. Write short, practical recipe steps a tired person can follow on a weekday.

When you receive feedback on a plan, fix every blocking and major issue, keep what was praised, and return the full revised plan.`;

export const JUDGE_SYSTEM_PROMPT = `You review weekly dinner plans for a household in Denmark before they are sent to them. Be demanding but fair.

Score the plan from 0 to 10 on:
- Safety: allergies are never violated (any violation means score 0 and a blocking issue).
- Variety: main proteins and cooking methods vary across the week; nothing repeats recent meals. A repeated cuisine is at most a minor issue.
- Nutrition: balanced plates with vegetables and fibre; per-serving values are provided and computed from a food database, trust them.
- Feasibility: weekday dinners fit the time limit; recipes are clear and realistic for home cooks.
- Value: dinners are built around the listed offers and the cost is sensible.
- Appeal: dinners a couple would look forward to, suitable for the season.

Approve only if the score is 7 or higher and there is no blocking issue. List concrete, actionable issues tied to a date where possible; mark issues blocking (must fix), major (should fix) or minor (nice to fix). Ingredients used in the steps should be in the ingredient list, except pantry staples (cooking oil, butter for frying, salt, pepper, dried herbs and spices, water), which never need listing. A missing non-staple ingredient is a minor issue.

The summary is shown to the household with the final plan: describe the week warmly in two or three sentences (what they will eat and why it works). Never mention problems or fixes in the summary; those belong in issues, which only the planner sees.`;

export interface WeekContext {
  weekKey: string;
  dates: string[];
  preferences: Preferences;
  history: MealRecord[];
}

export function plannerTask(ctx: WeekContext): string {
  const { settings, members, notes } = ctx.preferences;
  const memberLines = members.length
    ? members.map(
        (m) =>
          `- ${m.name}: allergies ${list(m.allergies)}; dislikes ${list(m.dislikes)}; likes ${list(m.likes)}; diet ${m.diet ?? 'none'}`,
      )
    : ['- No members recorded yet (no known allergies or dislikes).'];
  const recent = ctx.history.slice(0, 40).map((m) => `- ${m.date}: ${m.dish} (${m.mainProtein ?? '?'})${m.rating ? `, rated ${m.rating}` : ''}`);

  return `Plan ${settings.dinnersPerWeek} dinners for ISO week ${ctx.weekKey}. Use week "${ctx.weekKey}" in every search_offers call.

Dates in the week:
${ctx.dates.map((d, i) => `- ${d} ${dayName(d)}${i < 5 ? ' (weekday)' : ' (weekend)'}`).join('\n')}
Pick ${settings.dinnersPerWeek} distinct dates; spread them sensibly.

Household:
${memberLines.join('\n')}
- Servings per dinner: ${settings.servings}
- Max cooking time on weekdays: ${settings.maxWeekdayCookingMinutes} minutes
- Preferred chains: ${settings.preferredChains.length ? settings.preferredChains.join(', ') : 'any'}
- Weekly budget: ${settings.weeklyBudgetDkk ? `${settings.weeklyBudgetDkk} DKK` : 'not set, keep it economical'}
${notes.length ? `- Notes: ${notes.join(' | ')}` : ''}

Recent dinners (do not repeat any from the last ${NO_REPEAT_DAYS} days, and never repeat one rated down):
${recent.length ? recent.join('\n') : '- None recorded yet.'}`;
}

export function judgeTask(
  ctx: WeekContext,
  plan: MealPlanDraft,
  nutrition: Map<string, Nutrition>,
  checks: Issue[],
): string {
  const dinners = plan.dinners.map((d) => ({ ...d, day: dayName(d.date), nutritionPerServing: nutrition.get(d.date) ?? null }));
  return `${plannerTask(ctx)}

Automated checks already found these issues (include them in your judgement):
${checks.length ? checks.map(formatIssue).join('\n') : '- None.'}

The plan to review (nutrition is per serving):
${JSON.stringify({ notes: plan.notes, dinners }, null, 2)}`;
}

export function revisionFeedback(checks: Issue[], verdict: JudgeVerdict | null): string {
  const lines = ['Your plan needs another revision.'];
  if (checks.length) lines.push('', 'Automated checks:', ...checks.map(formatIssue));
  if (verdict) {
    lines.push('', `Reviewer score ${verdict.score}/10. ${verdict.summary}`);
    if (verdict.issues.length) lines.push('Reviewer issues:', ...verdict.issues.map(formatIssue));
  }
  lines.push('', 'Return the complete revised plan.');
  return lines.join('\n');
}

const formatIssue = (i: Issue) => `- [${i.severity}]${i.date ? ` ${i.date}:` : ''} ${i.message}`;
const list = (items: string[]) => (items.length ? items.join(', ') : 'none');
