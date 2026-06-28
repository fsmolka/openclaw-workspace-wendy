const DATA = window.HEALTH_DASHBOARD_DATA || { days: [], streams: [], goal: {} };
const state = { range: 7 };

const fmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const fmt1 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });

const $ = (id) => document.getElementById(id);
const number = (value) => typeof value === "number" && Number.isFinite(value);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function setText(id, value) {
  $(id).textContent = value;
}

function isCompact() {
  return window.matchMedia("(max-width: 760px)").matches;
}

function hasFood(day) {
  return number(day.calories_in);
}

function hasBurn(day) {
  return number(day.total_burn);
}

function completeDays() {
  return DATA.days.filter((day) => hasFood(day) && hasBurn(day) && !(day.quality_flags || []).includes("partial_day"));
}

function visibleDays() {
  const days = DATA.days.slice();
  return days.slice(-state.range);
}

function latestDay() {
  return DATA.days[DATA.days.length - 1] || {};
}

function latestCompleteDay() {
  const days = completeDays();
  return days[days.length - 1] || {};
}

function average(values) {
  const valid = values.filter(number);
  if (!valid.length) return null;
  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

function sum(values) {
  return values.filter(number).reduce((total, value) => total + value, 0);
}

function describeQuality(day) {
  const flags = day.quality_flags || [];
  if (!flags.length) return "clean";
  if (flags.includes("partial_day")) return "partial";
  if (flags.includes("activity_only")) return "activity only";
  if (flags.includes("missing_nutrition")) return "missing food";
  return flags.join(", ");
}

function riskClass(value, good, warn) {
  if (value >= good) return "ok";
  if (value >= warn) return "warn";
  return "bad";
}

function context() {
  const latest = latestDay();
  const complete = completeDays().slice(-7);
  const completeWindow = completeDays().slice(-state.range);
  const latestComplete = latestCompleteDay();
  const avgDeficit = average(complete.map((day) => day.deficit_kcal)) || 0;
  const avgProtein = average(complete.map((day) => day.protein_g)) || 0;
  const avgSteps = average(complete.map((day) => day.steps)) || 0;
  const avgSleep = average(complete.map((day) => day.sleep_hr)) || 0;
  const avgActive = average(complete.map((day) => day.active_kcal)) || 0;
  const intakeValues = complete.map((day) => day.calories_in).filter(number);
  const intakeRange = intakeValues.length ? Math.max(...intakeValues) - Math.min(...intakeValues) : 0;
  const weeklyDeficit = sum(complete.map((day) => day.deficit_kcal));
  const weeklyPoundsPace = weeklyDeficit / 3500;
  return {
    latest,
    latestComplete,
    complete,
    completeWindow,
    avgDeficit,
    avgProtein,
    avgSteps,
    avgSleep,
    avgActive,
    intakeRange,
    weeklyDeficit,
    weeklyPoundsPace
  };
}

function readinessScore(ctx) {
  const proteinScore = clamp((ctx.avgProtein / (DATA.goal.protein_target_g || 150)) * 100, 0, 110);
  const deficitTarget = DATA.goal.deficit_target_kcal || 500;
  const deficitScore = clamp(100 - Math.abs(ctx.avgDeficit - deficitTarget) / deficitTarget * 60, 0, 105);
  const stepScore = clamp((ctx.avgSteps / (DATA.goal.steps_target || 9000)) * 100, 0, 110);
  const sleepScore = clamp((ctx.avgSleep / (DATA.goal.sleep_target_hr || 7)) * 100, 0, 105);
  const volatilityPenalty = ctx.intakeRange > 950 ? 10 : ctx.intakeRange > 650 ? 5 : 0;
  return Math.round((proteinScore * 0.3) + (deficitScore * 0.3) + (stepScore * 0.2) + (sleepScore * 0.2) - volatilityPenalty);
}

function renderHeader() {
  setText("latestSync", DATA.latest_sync || DATA.generated_at || "demo");
  $("range7").classList.toggle("active", state.range === 7);
  $("range14").classList.toggle("active", state.range === 14);
}

function renderScoreStrip(ctx) {
  const latest = ctx.latest;
  const latestComplete = ctx.latestComplete;
  const todayPartial = (latest.quality_flags || []).includes("partial_day");
  const recoveryRisk = ctx.avgSleep < 6.6 || ctx.avgDeficit > 750 ? "Elevated" : ctx.avgSleep < 7 ? "Watch" : "Normal";

  setText("todayScore", todayPartial ? "In progress" : `${fmt.format(latest.deficit_kcal)} kcal`);
  setText(
    "todayScoreDetail",
    todayPartial
      ? isCompact() ? `Still building. Last complete: ${latestComplete.date}.` : `${latest.date} is still building. Last complete day: ${latestComplete.date}.`
      : `${latest.date} final daily deficit from food and Apple burn.`
  );
  setText("deficitPace", `${fmt.format(ctx.avgDeficit)} kcal/day`);
  setText("deficitPaceDetail", `7-day complete average; target is ${fmt.format(DATA.goal.deficit_target_kcal || 500)}.`);
  setText("proteinPace", `${fmt.format(ctx.avgProtein)}g/day`);
  setText("proteinPaceDetail", `Target is ${fmt.format(DATA.goal.protein_target_g || 150)}g/day.`);
  setText("recoveryRisk", recoveryRisk);
  setText("recoveryRiskDetail", `${fmt1.format(ctx.avgSleep)}h sleep average with ${fmt.format(ctx.avgActive)} kcal active burn.`);
}

function renderCoach(ctx) {
  const score = clamp(readinessScore(ctx), 0, 100);
  const mode = ctx.avgDeficit > 850 ? "Protect Recovery" : ctx.avgDeficit < 250 ? "Tighten Intake" : "Stay Consistent";
  const actions = [];

  actions.push({
    title: "Food target",
    body: ctx.avgDeficit > 850
      ? "Do not cut harder today. Hit protein, keep dinner controlled, and avoid another very low calorie day."
      : "Keep the daily deficit near target. Avoid turning good progress into noisy rebound hunger."
  });
  actions.push({
    title: "Protein floor",
    body: ctx.avgProtein >= (DATA.goal.protein_target_g || 150)
      ? "Protein is doing its job. Keep this stable while calories move around it."
      : `Add ${fmt.format((DATA.goal.protein_target_g || 150) - ctx.avgProtein)}g/day on average before lowering calories.`
  });
  actions.push({
    title: "Movement lever",
    body: ctx.avgSteps >= (DATA.goal.steps_target || 9000)
      ? "Steps are strong enough. Use easy movement as maintenance, not punishment."
      : "Bring steps back to target before reducing food. It is the cleaner lever right now."
  });

  setText("coachHeadline", mode);
  setText("coachMode", `${ctx.complete.length}-day read`);
  $("readinessRing").style.setProperty("--score", score);
  setText("readinessScore", score);
  setText(
    "readinessDetail",
    score >= 80 ? "Strong week. Main job is repeatability." : score >= 65 ? "Working week, but one lane needs attention." : "Progress is possible, but recovery or consistency is the limiting factor."
  );
  $("actionList").innerHTML = actions
    .map((action) => `<article class="action-card"><b>${action.title}</b><p>${action.body}</p></article>`)
    .join("");
}

function renderEnergyChart() {
  const days = visibleDays();
  const svg = $("energyChart");
  svg.innerHTML = "";
  const width = 1040;
  const height = 360;
  const pad = { left: 60, right: 28, top: 24, bottom: 48 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const maxEnergy = Math.max(3400, ...days.flatMap((day) => [day.calories_in || 0, day.total_burn || 0]));
  const group = plotW / Math.max(days.length, 1);
  const barW = Math.min(24, group * 0.24);
  const ns = "http://www.w3.org/2000/svg";

  function el(name, attrs = {}) {
    const node = document.createElementNS(ns, name);
    Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, value));
    svg.appendChild(node);
    return node;
  }
  function x(index) {
    return pad.left + group * index + group / 2;
  }
  function y(value) {
    return pad.top + plotH - (Math.max(0, value) / maxEnergy) * plotH;
  }

  [0, 1000, 2000, 3000].forEach((tick) => {
    el("line", { class: "axis", x1: pad.left, y1: y(tick), x2: width - pad.right, y2: y(tick) });
    el("text", { class: "axis-text", x: 10, y: y(tick) + 4 }).textContent = tick;
  });

  const linePoints = [];
  days.forEach((day, index) => {
    const cx = x(index);
    if (number(day.calories_in)) {
      el("rect", { class: "food-bar", x: cx - barW - 3, y: y(day.calories_in), width: barW, height: pad.top + plotH - y(day.calories_in), rx: 5 });
    }
    if (number(day.total_burn)) {
      el("rect", { class: "burn-bar", x: cx + 3, y: y(day.total_burn), width: barW, height: pad.top + plotH - y(day.total_burn), rx: 5 });
    }
    if (number(day.deficit_kcal)) linePoints.push([cx, y(day.deficit_kcal)]);
    el("text", { class: "day-text", x: cx - 18, y: height - 16 }).textContent = day.date.slice(5);
  });
  if (linePoints.length > 1) {
    el("polyline", { class: "deficit-line", points: linePoints.map(([px, py]) => `${px},${py}`).join(" ") });
    linePoints.forEach(([px, py]) => el("circle", { class: "deficit-dot", cx: px, cy: py, r: 5 }));
  }
}

function renderLanes(ctx) {
  const latest = ctx.latestComplete;
  const lanes = [
    {
      label: "Nutrition",
      value: `${fmt.format(ctx.avgProtein)}g`,
      detail: `Protein average vs ${DATA.goal.protein_target_g}g target.`,
      pct: (ctx.avgProtein / DATA.goal.protein_target_g) * 100
    },
    {
      label: "Movement",
      value: fmt.format(ctx.avgSteps),
      detail: `Average steps vs ${fmt.format(DATA.goal.steps_target)} target.`,
      pct: (ctx.avgSteps / DATA.goal.steps_target) * 100
    },
    {
      label: "Training",
      value: `${fmt.format(ctx.avgActive)} kcal`,
      detail: `Average active burn. Latest workout count: ${latest.workouts?.count || 0}.`,
      pct: (ctx.avgActive / DATA.goal.active_target_kcal) * 100
    },
    {
      label: "Recovery",
      value: `${fmt1.format(ctx.avgSleep)}h`,
      detail: `Average sleep vs ${fmt1.format(DATA.goal.sleep_target_hr)}h target.`,
      pct: (ctx.avgSleep / DATA.goal.sleep_target_hr) * 100
    }
  ];
  $("laneGrid").innerHTML = lanes.map((lane) => `
    <article class="lane">
      <p class="kicker">${lane.label}</p>
      <strong>${lane.value}</strong>
      <p>${lane.detail}</p>
      <div class="meter"><span style="--value:${clamp(lane.pct, 0, 110)}%"></span></div>
    </article>
  `).join("");
}

function renderRunway(ctx) {
  const pace = ctx.weeklyPoundsPace;
  const label = pace >= 0.25 ? `${fmt1.format(pace)} lb/week` : "Flat pace";
  setText("runwayPace", label);
  setText("runwayDetail", `${fmt.format(ctx.weeklyDeficit)} kcal deficit across the latest complete week. Use this as direction, not a promise.`);
  const maxDeficit = Math.max(1, ...ctx.complete.map((day) => Math.abs(day.deficit_kcal || 0)));
  $("runwayBars").innerHTML = ctx.complete.map((day) => {
    const height = 18 + (Math.max(0, day.deficit_kcal || 0) / maxDeficit) * 72;
    return `<span title="${day.date}: ${fmt.format(day.deficit_kcal)} kcal deficit" style="height:${height}px"></span>`;
  }).join("");
}

function renderMacroPanel(ctx) {
  const complete = ctx.complete;
  const avgCarbs = average(complete.map((day) => day.carbs_g)) || 0;
  const avgFat = average(complete.map((day) => day.fat_g)) || 0;
  const avgFiber = average(complete.map((day) => day.fiber_g)) || 0;
  const rows = [
    ["Protein", `${fmt.format(ctx.avgProtein)}g`, ctx.avgProtein >= DATA.goal.protein_target_g ? "On target for preserving lean mass." : "Below target; fix this before chasing a larger deficit.", (ctx.avgProtein / DATA.goal.protein_target_g) * 100],
    ["Carbs", `${fmt.format(avgCarbs)}g`, "Useful context for training output and hunger.", clamp(avgCarbs / 220 * 100, 0, 100)],
    ["Fat", `${fmt.format(avgFat)}g`, "Watch high-fat days because calories climb quickly.", clamp(avgFat / 90 * 100, 0, 100)],
    ["Fiber", `${fmt.format(avgFiber)}g`, "Satiety and food quality signal.", clamp(avgFiber / 30 * 100, 0, 100)]
  ];
  $("macroPanel").innerHTML = rows.map(([label, value, detail, pct]) => `
    <div class="macro-row">
      <div class="macro-head"><strong>${label}</strong><span>${value}</span></div>
      <div class="meter"><span style="--value:${pct}%"></span></div>
      <p>${detail}</p>
    </div>
  `).join("");
}

function renderRecoveryPanel(ctx) {
  const avgRhr = average(ctx.complete.map((day) => day.rhr));
  const avgHrv = average(ctx.complete.map((day) => day.hrv_ms));
  const rows = [
    ["Sleep", `${fmt1.format(ctx.avgSleep)} hr`, ctx.avgSleep >= 7 ? "Enough for the current deficit." : "Light sleep raises hunger and training risk."],
    ["Resting HR", avgRhr ? `${fmt.format(avgRhr)} bpm` : "No data", "Watch upward drift during aggressive weeks."],
    ["HRV", avgHrv ? `${fmt1.format(avgHrv)} ms` : "No data", "Trend signal only; single-day values are noisy."]
  ];
  $("recoveryPanel").innerHTML = rows.map(([label, value, detail]) => `
    <div class="signal-item">
      <strong><span>${label}</span><span>${value}</span></strong>
      <p>${detail}</p>
    </div>
  `).join("");
}

function renderPipeline() {
  const sourceRows = DATA.streams.map((stream) => `
    <div class="signal-item">
      <strong><span>${stream}</span><span class="ok">active</span></strong>
      <p>Accepted into the daily rollup after dedupe and quality checks.</p>
    </div>
  `);
  $("pipelinePanel").innerHTML = sourceRows.join("");
  setText("generatedAt", `${DATA.payloads_processed || 0} payloads processed. Public demo uses synthetic-safe data.`);
}

function renderRows() {
  $("dayRows").innerHTML = visibleDays().slice().reverse().map((day) => {
    const flag = describeQuality(day);
    const qualityClass = flag === "clean" ? "ok" : flag === "partial" ? "warn" : "bad";
    return `<tr>
      <td>${day.date}</td>
      <td>${number(day.calories_in) ? fmt.format(day.calories_in) : "-"}</td>
      <td>${number(day.total_burn) ? fmt.format(day.total_burn) : "-"}</td>
      <td>${number(day.deficit_kcal) ? fmt.format(day.deficit_kcal) : "-"}</td>
      <td class="${riskClass(day.protein_g || 0, DATA.goal.protein_target_g, 125)}">${number(day.protein_g) ? fmt.format(day.protein_g) : "-"}</td>
      <td>${number(day.steps) ? fmt.format(day.steps) : "-"}</td>
      <td>${number(day.sleep_hr) ? fmt1.format(day.sleep_hr) : "-"}</td>
      <td class="${qualityClass}">${flag}</td>
    </tr>`;
  }).join("");
}

function render() {
  const ctx = context();
  renderHeader();
  renderScoreStrip(ctx);
  renderCoach(ctx);
  renderEnergyChart(ctx);
  renderLanes(ctx);
  renderRunway(ctx);
  renderMacroPanel(ctx);
  renderRecoveryPanel(ctx);
  renderPipeline(ctx);
  renderRows(ctx);
}

$("range7").addEventListener("click", () => {
  state.range = 7;
  render();
});

$("range14").addEventListener("click", () => {
  state.range = 14;
  render();
});

render();
