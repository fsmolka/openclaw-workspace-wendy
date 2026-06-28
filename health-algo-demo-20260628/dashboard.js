const DATA = window.HEALTH_DASHBOARD_DATA || { days: [], streams: [], goal: {} };
const state = { range: 7 };

const fmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const fmt1 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });

function hasFood(day) {
  return typeof day.calories_in === "number";
}

function hasBurn(day) {
  return typeof day.total_burn === "number";
}

function completeDays() {
  return DATA.days.filter((day) => hasFood(day) && hasBurn(day) && !(day.quality_flags || []).length);
}

function visibleDays() {
  const days = DATA.days.slice();
  return state.range === "all" ? days : days.slice(-state.range);
}

function latestDay() {
  return DATA.days[DATA.days.length - 1] || {};
}

function latestCompleteDay() {
  const days = completeDays();
  return days[days.length - 1] || {};
}

function average(values) {
  const valid = values.filter((value) => typeof value === "number");
  if (!valid.length) return null;
  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

function setText(id, value) {
  document.getElementById(id).textContent = value;
}

function describeQuality(day) {
  const flags = day.quality_flags || [];
  if (!flags.length) return "clean";
  if (flags.includes("missing_nutrition")) return "missing nutrition";
  if (flags.includes("activity_only")) return "activity only";
  if (flags.includes("partial_day")) return "partial";
  return flags.join(", ");
}

function renderStatus() {
  const today = latestDay();
  const complete = completeDays().slice(-7);
  const latestComplete = latestCompleteDay();
  const avgDef = average(complete.map((day) => day.deficit_kcal));
  const avgProtein = average(complete.map((day) => day.protein_g));
  const missingToday = (today.quality_flags || []).length > 0;

  setText("todayStatus", missingToday ? "Partial" : `${fmt.format(today.deficit_kcal || 0)} kcal`);
  setText(
    "todayDetail",
    missingToday
      ? `${today.date || "Today"} is not final yet. Latest complete day is ${latestComplete.date || "none"}.`
      : `${today.date}: deficit after intake and Apple burn.`
  );

  setText("avgDeficit", avgDef === null ? "No data" : `${fmt.format(avgDef)} kcal`);
  setText("avgDeficitDetail", `${complete.length}-day complete window, positive means deficit.`);

  setText("proteinStatus", avgProtein === null ? "No data" : `${fmt.format(avgProtein)}g/day`);
  setText("proteinDetail", `Target is ${DATA.goal.protein_target_g || 150}g/day.`);

  setText("qualityStatus", missingToday ? "Partial today" : "Clean");
  setText("qualityDetail", "Apple Health transport, daily rollup is source of truth.");
}

function renderEnergyChart() {
  const days = visibleDays();
  const svg = document.getElementById("energyChart");
  svg.innerHTML = "";
  setText("energyWindow", state.range === "all" ? "All available days" : "Last 7 days");

  const width = 920;
  const height = 300;
  const pad = { left: 54, right: 24, top: 22, bottom: 44 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const maxEnergy = Math.max(
    3200,
    ...days.flatMap((day) => [day.calories_in || 0, day.total_burn || 0, Math.abs(day.deficit_kcal || 0)])
  );
  const group = plotW / Math.max(days.length, 1);
  const barW = Math.min(22, group * 0.22);

  function x(index) {
    return pad.left + group * index + group / 2;
  }
  function y(value) {
    return pad.top + plotH - (Math.max(0, value) / maxEnergy) * plotH;
  }

  const ns = "http://www.w3.org/2000/svg";
  function el(name, attrs = {}) {
    const node = document.createElementNS(ns, name);
    Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, value));
    svg.appendChild(node);
    return node;
  }

  [0, 1000, 2000, 3000].forEach((tick) => {
    el("line", { class: "axis", x1: pad.left, y1: y(tick), x2: width - pad.right, y2: y(tick) });
    el("text", { class: "chart-label", x: 8, y: y(tick) + 4 }).textContent = tick;
  });

  const linePoints = [];
  days.forEach((day, index) => {
    const cx = x(index);
    if (typeof day.calories_in === "number") {
      el("rect", {
        class: "bar-in",
        x: cx - barW - 2,
        y: y(day.calories_in),
        width: barW,
        height: pad.top + plotH - y(day.calories_in),
        rx: 4,
      });
    }
    if (typeof day.total_burn === "number") {
      el("rect", {
        class: "bar-burn",
        x: cx + 2,
        y: y(day.total_burn),
        width: barW,
        height: pad.top + plotH - y(day.total_burn),
        rx: 4,
      });
    }
    if (typeof day.deficit_kcal === "number") {
      linePoints.push(`${cx},${y(day.deficit_kcal)}`);
    }
    el("text", { class: "chart-label", x: cx - 18, y: height - 14 }).textContent = day.date.slice(5);
  });
  if (linePoints.length > 1) {
    el("polyline", { class: "deficit-line", points: linePoints.join(" ") });
  }
}

function renderMovement() {
  const complete = completeDays().slice(-7);
  const latest = latestCompleteDay();
  const movement = [
    ["Steps", latest.steps ? fmt.format(latest.steps) : "No data", `Latest complete day: ${latest.date || "none"}`],
    ["Active energy", latest.active_kcal ? `${fmt.format(latest.active_kcal)} kcal` : "No data", "Apple Health active burn"],
    ["Exercise", latest.exercise_min ? `${fmt.format(latest.exercise_min)} min` : "No data", `${latest.workouts?.count || 0} workout sessions logged`],
    ["Sleep", latest.sleep_hr ? `${fmt1.format(latest.sleep_hr)} hr` : "No data", "Recovery context, not a full readiness score yet"],
    ["Avg steps", `${fmt.format(average(complete.map((day) => day.steps)) || 0)}`, "7-day complete average"],
    ["Avg active", `${fmt.format(average(complete.map((day) => day.active_kcal)) || 0)} kcal`, "7-day complete average"],
    ["Weight", latest.weight_lb ? `${fmt1.format(latest.weight_lb)} lb` : "No fresh weight", "Use trend, not one weigh-in"],
    ["HRV", latest.hrv_ms ? `${fmt1.format(latest.hrv_ms)} ms` : "No data", "Watch trend with sleep and training"],
  ];
  document.getElementById("movementGrid").innerHTML = movement
    .map(([label, value, detail]) => `<div class="metric"><p class="label">${label}</p><strong>${value}</strong><span>${detail}</span></div>`)
    .join("");
}

function renderCoach() {
  const complete = completeDays().slice(-7);
  const latest = latestCompleteDay();
  const avgDef = average(complete.map((day) => day.deficit_kcal)) || 0;
  const avgProtein = average(complete.map((day) => day.protein_g)) || 0;
  const intakeRange = Math.max(...complete.map((day) => day.calories_in || 0)) - Math.min(...complete.map((day) => day.calories_in || 0));
  const items = [];

  if (avgDef >= 500) items.push(`Deficit is aggressive at about ${fmt.format(avgDef)} kcal/day. Keep protein high and watch recovery.`);
  else if (avgDef >= 150) items.push(`Deficit is controlled at about ${fmt.format(avgDef)} kcal/day. Good cutting pace.`);
  else items.push("Average deficit is light. Tighten food cap or add movement if weight trend stalls.");

  if (avgProtein >= (DATA.goal.protein_target_g || 150)) items.push(`Protein is strong at about ${fmt.format(avgProtein)}g/day.`);
  else items.push(`Protein is short at about ${fmt.format(avgProtein)}g/day. This is the first nutrition fix.`);

  if (intakeRange >= 900) items.push("Food intake is volatile. The app should flag low days before they rebound into high days.");
  if ((latest.sleep_hr || 0) < 6.5) items.push("Latest complete sleep is light. Do not judge training output without recovery context.");
  if ((latest.active_kcal || 0) < 450) items.push("Latest complete active energy is below baseline. Add easy movement before cutting food harder.");

  document.getElementById("coachHeadline").textContent = "Current read";
  document.getElementById("coachList").innerHTML = items.slice(0, 5).map((item) => `<li>${item}</li>`).join("");
}

function renderRecovery() {
  const complete = completeDays().slice(-7);
  const avgSleep = average(complete.map((day) => day.sleep_hr));
  const avgRhr = average(complete.map((day) => day.rhr));
  const avgHrv = average(complete.map((day) => day.hrv_ms));
  const rows = [
    ["Sleep", avgSleep ? `${fmt1.format(avgSleep)} hr average` : "Not enough sleep data", "Useful for hunger, training output, and deficit tolerance."],
    ["Resting HR", avgRhr ? `${fmt.format(avgRhr)} bpm average` : "Not enough RHR data", "Watch drift upward during heavy deficit weeks."],
    ["HRV", avgHrv ? `${fmt1.format(avgHrv)} ms average` : "Not enough HRV data", "Use trend only; single days are noisy."],
  ];
  document.getElementById("recoveryList").innerHTML = rows
    .map(([label, value, detail]) => `<div class="recovery-item"><strong>${label}: ${value}</strong><span>${detail}</span></div>`)
    .join("");
}

function renderSources() {
  document.getElementById("sourceList").innerHTML = DATA.streams
    .map((source) => `<div class="source-item"><strong>${source}</strong><span>Accepted after source filtering and dedupe.</span></div>`)
    .join("");
  setText("generatedAt", `Data generated: ${DATA.generated_at || "unknown"} from ${DATA.payloads_processed || 0} processed payloads.`);
}

function renderRows() {
  const rows = visibleDays()
    .slice()
    .reverse()
    .map((day) => {
      const flag = describeQuality(day);
      return `<tr>
        <td>${day.date}</td>
        <td>${day.calories_in ? fmt.format(day.calories_in) : "-"}</td>
        <td>${day.total_burn ? fmt.format(day.total_burn) : "-"}</td>
        <td>${day.deficit_kcal ? fmt.format(day.deficit_kcal) : "-"}</td>
        <td>${day.protein_g ? fmt.format(day.protein_g) : "-"}</td>
        <td>${day.steps ? fmt.format(day.steps) : "-"}</td>
        <td>${day.sleep_hr ? fmt1.format(day.sleep_hr) : "-"}</td>
        <td class="${flag === "clean" ? "ok" : "flag"}">${flag}</td>
      </tr>`;
    });
  document.getElementById("dayRows").innerHTML = rows.join("");
}

function render() {
  document.getElementById("range7").classList.toggle("active", state.range === 7);
  document.getElementById("rangeAll").classList.toggle("active", state.range === "all");
  renderStatus();
  renderEnergyChart();
  renderMovement();
  renderCoach();
  renderRecovery();
  renderSources();
  renderRows();
}

document.getElementById("range7").addEventListener("click", () => {
  state.range = 7;
  render();
});

document.getElementById("rangeAll").addEventListener("click", () => {
  state.range = "all";
  render();
});

render();
