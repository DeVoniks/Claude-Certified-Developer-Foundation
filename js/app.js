(() => {
  "use strict";

  const { modules, exam } = window.CCDV;
  const EXAMS = window.CCDV_EXAMS || [];
  const examById = (id) => EXAMS.find((e) => String(e.id) === String(id));
  const STORE_KEY = "ccdv-prep-v1";
  const PASS_PCT = 72; // module quiz "passed" threshold, mirrors 720/1000
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const app = $("#app");
  const nav = $("#nav");

  /* ---------------- state ---------------- */

  const blank = () => ({ plan: null, checks: {}, quiz: {}, mock: [], manual: {}, exams: {} });
  let S = load();

  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      return raw ? { ...blank(), ...JSON.parse(raw) } : blank();
    } catch {
      return blank();
    }
  }
  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(S));
    } catch {
      /* storage unavailable: progress lives for this session only */
    }
  }

  /* ---------------- helpers ---------------- */

  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const toISO = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const fromISO = (s) => {
    const [y, m, d] = s.split("-").map(Number);
    return new Date(y, m - 1, d);
  };
  const addDays = (iso, n) => {
    const d = fromISO(iso);
    d.setDate(d.getDate() + n);
    return toISO(d);
  };
  const diffDays = (a, b) => Math.round((fromISO(a) - fromISO(b)) / 86400000);
  const todayISO = () => toISO(new Date());
  const fmtDate = (iso, opts = { weekday: "short", month: "short", day: "numeric" }) =>
    fromISO(iso).toLocaleDateString(undefined, opts);
  const fmtMin = (m) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? " " + (m % 60) + "m" : ""}` : `${m}m`);
  const shuffle = (arr) => {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  const moduleById = (id) => modules.find((m) => m.id === id);

  /* ---------------- units & completion ---------------- */

  function allUnits() {
    const units = [];
    for (const m of modules) {
      for (const s of m.steps) {
        units.push({ key: `s:${m.id}:${s.id}`, type: "step", module: m, step: s, minutes: s.minutes, title: s.title });
      }
      if (m.quiz.length) {
        units.push({
          key: `q:${m.id}`,
          type: "quiz",
          module: m,
          minutes: m.quiz.length * 2 + 5,
          title: `Module quiz: ${m.title}`,
        });
      }
    }
    return units;
  }

  const stepDone = (s) => s.checklist.every((_, i) => S.checks[`${s.id}:${i}`]);
  const bestQuiz = (id) => {
    const r = S.quiz[id] || [];
    return r.length ? Math.max(...r.map((x) => x.pct)) : null;
  };
  const quizPassed = (id) => (bestQuiz(id) ?? -1) >= PASS_PCT;

  function unitDone(u) {
    switch (u.type) {
      case "step": return stepDone(u.step);
      case "quiz": return quizPassed(u.module.id);
      case "mock": return S.mock.length > 0;
      case "exam": return (S.exams[u.exam.id] || []).length > 0;
      default: return !!S.manual[u.key];
    }
  }

  function moduleProgress(m) {
    const items = m.steps.map(stepDone);
    if (m.quiz.length) items.push(quizPassed(m.id));
    const done = items.filter(Boolean).length;
    return { done, total: items.length, pct: Math.round((done / items.length) * 100) };
  }

  /* ---------------- planner ---------------- */

  // Prep days run from plan.start up to (not including) plan.exam.
  const prepDays = (plan) => Math.max(3, diffDays(plan.exam, plan.start));

  // Split N prep days into study days, an optional review day, and a tail of
  // practice-exam days (about a third of the plan, at most one per exam).
  function layout(N) {
    const examDays = EXAMS.length ? Math.min(EXAMS.length, Math.max(1, Math.floor(N / 3))) : 1;
    const hasReview = N - examDays >= 7;
    const studyDays = Math.max(1, N - examDays - (hasReview ? 1 : 0));
    return { examDays, hasReview, studyDays };
  }

  function buildSchedule(plan) {
    const N = prepDays(plan);
    const exclude = new Set(plan.exclude || []);
    const units = allUnits().filter((u) => !exclude.has(u.key));
    const { examDays, hasReview, studyDays } = layout(N);
    const days = Array.from({ length: N }, (_, i) => ({ index: i, date: addDays(plan.start, i), tasks: [], kind: "study" }));

    // Spread units in order, balancing minutes: each unit lands on the day its
    // midpoint falls into along the cumulative-minutes timeline.
    const total = units.reduce((a, u) => a + u.minutes, 0) || 1;
    let cum = 0;
    for (const u of units) {
      const d = Math.min(studyDays - 1, Math.floor(((cum + u.minutes / 2) / total) * studyDays));
      days[d].tasks.push(u);
      cum += u.minutes;
    }

    for (let i = 0; i < studyDays; i++) {
      if (!days[i].tasks.length) {
        days[i].kind = "practice";
        days[i].tasks.push({
          key: `p:${days[i].date}`,
          type: "manual",
          minutes: 45,
          title: "Practice day: retake earlier module quizzes and re-read checklists you hesitated on",
        });
      }
    }

    if (hasReview) {
      const d = days[studyDays];
      d.kind = "review";
      d.tasks.push(
        { key: "r:weak", type: "manual", minutes: 60, title: "Review weak areas: retake any module quiz below 80%" },
        { key: "r:checklists", type: "manual", minutes: 45, title: "Skim every module checklist and re-study anything you can't explain aloud" }
      );
    }

    const tail = days.slice(N - examDays);
    tail.forEach((d) => (d.kind = "exam"));
    if (EXAMS.length) {
      // At most two full exams per day; any extra exams stay available from the sidebar.
      // Assign exams in order; the earlier exam days take the extra one so the
      // final day before the real exam stays lighter.
      const scheduled = EXAMS.slice(0, examDays * 2);
      const base = Math.floor(scheduled.length / examDays);
      const extra = scheduled.length % examDays;
      const dayOf = [];
      for (let d = 0; d < examDays; d++) for (let k = 0; k < base + (d < extra ? 1 : 0); k++) dayOf.push(d);
      scheduled.forEach((e, i) =>
        tail[dayOf[i]].tasks.push({
          key: `x:${e.id}`,
          type: "exam",
          exam: e,
          minutes: exam.minutes,
          title: `${e.title} (${e.questions.length} questions, timed) + review your mistakes`,
        })
      );
    } else {
      tail[0].tasks.push({ key: "mock", type: "mock", minutes: exam.minutes, title: `Full mock exam (${exam.questions} questions, ${exam.minutes} min)` });
    }
    days[N - 1].tasks.push(
      { key: "r:logistics", type: "manual", minutes: 15, title: "Exam logistics: ID ready, Pearson VUE check-in tested, quiet room booked" }
    );

    return days;
  }

  function scheduleStatus(plan, days) {
    const t = diffDays(todayISO(), plan.start);
    const all = days.flatMap((d) => d.tasks);
    const done = all.filter(unitDone).length;
    const overdue = days.filter((d) => d.index < t).flatMap((d) => d.tasks).filter((u) => !unitDone(u));
    return { todayIdx: t, done, total: all.length, pct: Math.round((done / all.length) * 100), overdue };
  }

  /* ---------------- routing ---------------- */

  let timer = null;
  let leaveGuard = null; // returns true while an attempt has unsaved answers
  let currentHash = location.hash;
  window.addEventListener("hashchange", route);
  window.addEventListener("beforeunload", (e) => {
    if (leaveGuard && leaveGuard()) e.preventDefault();
  });

  function route() {
    if (leaveGuard && leaveGuard() && location.hash !== currentHash) {
      if (!confirm("Leave this attempt? Your answers will be lost.")) {
        history.replaceState(null, "", currentHash || "#/");
        return;
      }
    }
    leaveGuard = null;
    currentHash = location.hash;
    clearInterval(timer);
    const parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
    const [view, a, b] = parts;
    if (!S.plan && !["setup", "module", "quiz", "mock", "exam"].includes(view)) {
      renderSetup();
    } else if (view === "setup") renderSetup();
    else if (view === "module" && moduleById(a)) renderModule(moduleById(a), b);
    else if (view === "quiz" && moduleById(a)) renderQuiz(moduleById(a));
    else if (view === "mock") renderMock();
    else if (view === "exam" && examById(a)) renderExam(examById(a));
    else renderDashboard();
    renderNav(view, a);
    window.scrollTo(0, 0);
    if (view === "module" && b) {
      const el = document.getElementById(`step-${b}`);
      if (el) el.scrollIntoView({ block: "start" });
    }
    document.body.classList.remove("nav-open");
  }

  /* ---------------- nav ---------------- */

  function renderNav(view, id) {
    const link = (href, label, active, extra = "") =>
      `<a href="${href}" class="nav-link${active ? " active" : ""}">${label}${extra}</a>`;
    nav.innerHTML = `
      ${link("#/", "Dashboard", !view || view === "dashboard")}
      ${link("#/setup", "Study plan", view === "setup")}
      <div class="nav-head">Modules</div>
      ${modules
        .map((m, i) => {
          const p = moduleProgress(m);
          return link(
            `#/module/${m.id}`,
            `<span class="nav-num">${i}</span><span class="nav-title">${esc(m.title)}</span>`,
            (view === "module" || view === "quiz") && id === m.id,
            `<span class="nav-pct${p.pct === 100 ? " full" : ""}">${p.pct}%</span>`
          );
        })
        .join("")}
      <div class="nav-head">Final</div>
      ${EXAMS.map((e) => {
        const best = bestExam(e.id);
        return link(
          `#/exam/${e.id}`,
          `<span class="nav-num">E${e.id}</span><span class="nav-title">${esc(e.title)}</span>`,
          view === "exam" && String(id) === String(e.id),
          best !== null ? `<span class="nav-pct${best >= exam.passScaled ? " full" : ""}">${best}</span>` : ""
        );
      }).join("")}
      ${link("#/mock", `<span class="nav-num">M</span><span class="nav-title">Domain mock (from quizzes)</span>`, view === "mock", S.mock.length ? `<span class="nav-pct full">${S.mock.at(-1).scaled}</span>` : "")}
    `;
  }

  const bestExam = (id) => {
    const r = S.exams[id] || [];
    return r.length ? Math.max(...r.map((x) => x.scaled)) : null;
  };

  /* ---------------- setup ---------------- */

  function renderSetup() {
    const p = S.plan;
    const start = p?.start || todayISO();
    const mode = p?.mode || "14";
    const customExam = p?.mode === "custom" ? p.exam : addDays(start, 21);
    const totalMin = allUnits().reduce((a, u) => a + u.minutes, 0);

    app.innerHTML = `
      <section class="hero">
        <p class="eyebrow">${esc(exam.code)} preparation</p>
        <h1>${p ? "Adjust your study plan" : "Plan your path to Claude Certified Developer"}</h1>
        <p class="lead">Pick how long you have. The planner spreads ${modules.length} modules,
        ${modules.reduce((a, m) => a + m.steps.length, 0)} lessons and
        ${modules.reduce((a, m) => a + m.quiz.length, 0)} practice questions across your days,
        then saves a review day and ${EXAMS.length ? `${EXAMS.length} full-length practice exams` : "a full mock exam"} for the end.</p>
      </section>

      <form id="setup" class="card setup">
        <fieldset>
          <legend>How long do you have?</legend>
          <div class="choice-grid">
            ${[
              ["7", "1 week", "Intensive · 7 days"],
              ["14", "2 weeks", "Recommended · 14 days"],
              ["custom", "Custom", "Pick your exam date"],
            ]
              .map(
                ([v, t, s]) => `
              <label class="choice">
                <input type="radio" name="mode" value="${v}" ${mode === v ? "checked" : ""}>
                <span class="choice-body"><strong>${t}</strong><small>${s}</small></span>
              </label>`
              )
              .join("")}
          </div>
        </fieldset>

        <div class="field-row">
          <label class="field">
            <span>Start date</span>
            <input type="date" name="start" value="${start}" required>
          </label>
          <label class="field" id="exam-field">
            <span>Exam date</span>
            <input type="date" name="exam" value="${customExam}">
          </label>
        </div>

        <div id="preview" class="preview"></div>

        <div class="actions">
          <button class="btn primary" type="submit">${p ? "Update plan" : "Generate my plan"}</button>
          ${p ? `<a class="btn ghost" href="#/">Cancel</a>` : ""}
        </div>
        ${p ? `<p class="muted small">Your checklist and quiz progress is kept when you change the plan.</p>` : ""}
      </form>

      ${
        p
          ? `<section class="card danger-zone">
               <h3>Reset</h3>
               <p class="muted">Clears your plan, checklists, quiz scores and mock exam history on this device.</p>
               <button class="btn danger" id="reset">Reset all progress</button>
             </section>`
          : ""
      }
    `;

    const form = $("#setup");
    const examField = $("#exam-field");
    const preview = $("#preview");

    function compute() {
      const fd = new FormData(form);
      const m = fd.get("mode");
      const s = fd.get("start") || todayISO();
      const e = m === "custom" ? fd.get("exam") : addDays(s, Number(m));
      return { mode: m, start: s, exam: e };
    }

    function update() {
      const { mode: m, start: s, exam: e } = compute();
      examField.classList.toggle("disabled", m !== "custom");
      examField.querySelector("input").disabled = m !== "custom";
      if (m !== "custom") examField.querySelector("input").value = e;
      const n = diffDays(e, s);
      if (!e || n < 3) {
        preview.innerHTML = `<p class="warn">Choose an exam date at least 3 days after your start date.</p>`;
        return false;
      }
      const { studyDays } = layout(n);
      const perDay = Math.round(totalMin / studyDays);
      const intensity = perDay > 180 ? "Intensive" : perDay > 90 ? "Steady" : "Relaxed";
      preview.innerHTML = `
        <div class="stat"><span>${n}</span><small>prep days</small></div>
        <div class="stat"><span>${fmtMin(perDay)}</span><small>per study day</small></div>
        <div class="stat"><span>${intensity}</span><small>pace</small></div>
        <div class="stat"><span>${fmtDate(e, { month: "short", day: "numeric" })}</span><small>exam day</small></div>`;
      return true;
    }

    form.addEventListener("input", update);
    form.addEventListener("submit", (ev) => {
      ev.preventDefault();
      if (!update()) return;
      const next = compute();
      S.plan = { ...next, exclude: [], created: todayISO() };
      save();
      location.hash = "#/";
    });
    $("#reset")?.addEventListener("click", () => {
      if (confirm("Reset all progress? This cannot be undone.")) {
        S = blank();
        save();
        location.hash = "#/setup";
        route();
      }
    });
    update();
  }

  /* ---------------- dashboard ---------------- */

  function taskLink(u) {
    if (u.type === "step") return `#/module/${u.module.id}/${u.step.id}`;
    if (u.type === "quiz") return `#/quiz/${u.module.id}`;
    if (u.type === "mock") return "#/mock";
    if (u.type === "exam") return `#/exam/${u.exam.id}`;
    return null;
  }

  function taskRow(u) {
    const done = unitDone(u);
    const href = taskLink(u);
    const tag =
      u.type === "quiz" ? `<span class="tag quiz">Quiz</span>` :
      u.type === "mock" ? `<span class="tag mock">Mock</span>` :
      u.type === "exam" ? `<span class="tag mock">Exam</span>` :
      u.type === "step" ? `<span class="tag">${esc(u.module.short)}</span>` :
      `<span class="tag review">Review</span>`;
    const control =
      u.type === "manual"
        ? `<input type="checkbox" class="manual" data-key="${u.key}" ${done ? "checked" : ""} aria-label="Mark done">`
        : `<span class="dot${done ? " done" : ""}" aria-label="${done ? "Done" : "Not done"}"></span>`;
    const extra =
      u.type === "quiz" && bestQuiz(u.module.id) !== null ? ` · best ${bestQuiz(u.module.id)}%` :
      u.type === "exam" && bestExam(u.exam.id) !== null ? ` · best ${bestExam(u.exam.id)}/1000` : "";
    const label = href ? `<a href="${href}">${esc(u.title)}</a>` : `<span>${esc(u.title)}</span>`;
    return `<li class="task${done ? " done" : ""}">${control}<div class="task-main">${label}
      <div class="task-meta">${tag}<span>${fmtMin(u.minutes)}${extra}</span></div></div></li>`;
  }

  function renderDashboard() {
    const plan = S.plan;
    const days = buildSchedule(plan);
    const st = scheduleStatus(plan, days);
    const daysLeft = diffDays(plan.exam, todayISO());
    const todayDay = days[st.todayIdx];
    const notStarted = st.todayIdx < 0;
    const finished = st.todayIdx >= days.length;

    let focus;
    if (notStarted) {
      focus = `<p>Your plan starts <strong>${fmtDate(plan.start)}</strong>. You can get ahead now with Day 1:</p>
               <ul class="tasks">${days[0].tasks.map(taskRow).join("")}</ul>`;
    } else if (finished) {
      focus = `<p>Your prep window has ended. ${S.mock.length ? "Good luck on the exam!" : "Take the mock exam before you sit the real one."}</p>`;
    } else {
      focus = `<ul class="tasks">${todayDay.tasks.map(taskRow).join("")}</ul>`;
    }

    const behind = st.overdue.length;
    const statusBanner =
      notStarted || finished
        ? ""
        : behind
        ? `<div class="banner warn">
             <div><strong>${behind} task${behind > 1 ? "s" : ""} behind schedule.</strong>
             Catch up, or rebalance the rest of the plan over the days you have left.</div>
             <button class="btn small" id="rebalance">Rebalance from today</button>
           </div>`
        : `<div class="banner ok"><strong>On track.</strong> Keep going.</div>`;

    app.innerHTML = `
      <section class="dash-head">
        <div>
          <p class="eyebrow">${esc(exam.code)} · ${plan.mode === "custom" ? "Custom plan" : plan.mode === "7" ? "1-week plan" : "2-week plan"}</p>
          <h1>${finished ? "Prep complete" : notStarted ? "Ready to start" : `Day ${st.todayIdx + 1} of ${days.length}`}</h1>
          <p class="muted">${fmtDate(plan.start)} → exam ${fmtDate(plan.exam)}${daysLeft >= 0 ? ` · ${daysLeft} day${daysLeft === 1 ? "" : "s"} to go` : ""}</p>
        </div>
        <div class="ring" style="--p:${st.pct}">
          <span>${st.pct}%</span><small>${st.done}/${st.total} tasks</small>
        </div>
      </section>

      ${statusBanner}

      <section class="card">
        <h2>${notStarted ? "Get a head start" : finished ? "Wrap up" : "Today's focus"}</h2>
        ${focus}
      </section>

      <section class="card">
        <div class="card-head">
          <h2>Full timeline</h2>
          <a class="btn ghost small" href="#/setup">Change plan</a>
        </div>
        <ol class="timeline">
          ${days
            .map((d) => {
              const done = d.tasks.every(unitDone);
              const isToday = d.index === st.todayIdx;
              const past = d.index < st.todayIdx;
              const mins = d.tasks.reduce((a, u) => a + u.minutes, 0);
              const state = done ? "done" : past ? "late" : isToday ? "today" : "";
              const label = { review: "Review day", exam: "Practice exam day", practice: "Practice day", study: "Study" }[d.kind];
              return `<li class="day ${state}">
                <details ${isToday || (st.todayIdx < 0 && d.index === 0) ? "open" : ""}>
                  <summary>
                    <span class="day-badge">${d.index + 1}</span>
                    <span class="day-title">${fmtDate(d.date)}${isToday ? ` <em class="pill">Today</em>` : ""}</span>
                    <span class="day-meta">${label} · ${fmtMin(mins)} · ${d.tasks.filter(unitDone).length}/${d.tasks.length}</span>
                  </summary>
                  <ul class="tasks">${d.tasks.map(taskRow).join("")}</ul>
                </details>
              </li>`;
            })
            .join("")}
        </ol>
      </section>
    `;

    bindManual();
    $("#rebalance")?.addEventListener("click", () => {
      const done = allUnits().filter(unitDone).map((u) => u.key);
      const t = todayISO();
      const examDate = diffDays(plan.exam, t) >= 3 ? plan.exam : addDays(t, 3);
      S.plan = { ...plan, start: t, exam: examDate, exclude: done };
      save();
      renderDashboard();
      renderNav("dashboard");
    });
  }

  function bindManual() {
    $$("input.manual").forEach((cb) =>
      cb.addEventListener("change", () => {
        S.manual[cb.dataset.key] = cb.checked;
        save();
        route();
      })
    );
  }

  /* ---------------- module ---------------- */

  function renderModule(m) {
    const idx = modules.indexOf(m);
    const next = modules[idx + 1];
    const prev = modules[idx - 1];

    app.innerHTML = `
      <section class="mod-head">
        <p class="eyebrow">Module ${idx}${m.weight ? ` · ${m.weight}% of exam` : ""}</p>
        <h1>${esc(m.title)}</h1>
        <p class="lead">${esc(m.summary)}</p>
        <div class="progress"><div class="bar" id="mod-bar"></div></div>
        <p class="muted small" id="mod-progress"></p>
      </section>

      ${m.steps
        .map(
          (s, i) => `
        <article class="card step" id="step-${s.id}">
          <header class="step-head">
            <span class="step-num">Step ${i + 1}</span>
            <h2>${esc(s.title)}</h2>
            <span class="step-meta">${fmtMin(s.minutes)} <span class="status" data-step="${s.id}"></span></span>
          </header>
          <div class="prose">${s.body}</div>
          <div class="checklist">
            <h3>Checklist</h3>
            ${s.checklist
              .map(
                (c, j) => `
              <label class="check">
                <input type="checkbox" data-check="${s.id}:${j}" ${S.checks[`${s.id}:${j}`] ? "checked" : ""}>
                <span>${esc(c)}</span>
              </label>`
              )
              .join("")}
          </div>
        </article>`
        )
        .join("")}

      ${
        m.quiz.length
          ? `<section class="card quiz-cta">
              <div>
                <h2>Module quiz</h2>
                <p class="muted">${m.quiz.length} exam-style questions. Score ${PASS_PCT}%+ to complete the module.
                ${bestQuiz(m.id) !== null ? `Best so far: <strong>${bestQuiz(m.id)}%</strong>.` : ""}</p>
              </div>
              <a class="btn primary" href="#/quiz/${m.id}">${bestQuiz(m.id) !== null ? "Retake quiz" : "Start quiz"}</a>
            </section>`
          : ""
      }

      <nav class="pager">
        ${prev ? `<a class="btn ghost" href="#/module/${prev.id}">← ${esc(prev.title)}</a>` : "<span></span>"}
        ${next ? `<a class="btn ghost" href="#/module/${next.id}">${esc(next.title)} →</a>` : `<a class="btn ghost" href="#/mock">Mock exam →</a>`}
      </nav>
    `;

    const refresh = () => {
      m.steps.forEach((s) => {
        const el = $(`[data-step="${s.id}"]`);
        el.textContent = stepDone(s) ? "✓ Done" : "";
        el.className = "status" + (stepDone(s) ? " done" : "");
      });
      const p = moduleProgress(m);
      $("#mod-bar").style.width = p.pct + "%";
      $("#mod-progress").textContent = `${p.done} of ${p.total} items complete`;
      renderNav("module", m.id);
    };

    $$("input[data-check]").forEach((cb) =>
      cb.addEventListener("change", () => {
        S.checks[cb.dataset.check] = cb.checked;
        save();
        refresh();
      })
    );
    refresh();
  }

  /* ---------------- quiz engine ---------------- */

  function prepQuestions(list, { fixed = false } = {}) {
    return (fixed ? list : shuffle(list)).map((item) => {
      const raw = item.q.options.map((text, i) => ({ text, correct: item.q.answer.includes(i) }));
      const opts = fixed ? raw : shuffle(raw);
      return { ...item, opts, need: item.q.answer.length };
    });
  }

  function renderQuizBody(qs, { title, subtitle, onSubmit, timed, letters }) {
    app.innerHTML = `
      <section class="mod-head">
        <p class="eyebrow">${esc(subtitle)}</p>
        <h1>${esc(title)}</h1>
        ${timed ? `<div class="timer" id="timer"></div>` : ""}
      </section>
      <form id="quiz">
        ${qs
          .map(
            (item, i) => `
          <fieldset class="card question" id="q${i}">
            <legend><span class="qnum">Q${i + 1}</span> ${esc(item.q.q)}</legend>
            ${item.need > 1 && !/Select \d/.test(item.q.q) ? `<p class="hint">Select ${item.need}.</p>` : ""}
            ${item.opts
              .map(
                (o, j) => `
              <label class="option">
                <input type="${item.need > 1 ? "checkbox" : "radio"}" name="q${i}" value="${j}">
                <span>${letters ? `<b class="opt-letter">${String.fromCharCode(65 + j)}.</b> ` : ""}${esc(o.text)}</span>
              </label>`
              )
              .join("")}
            <div class="explain" hidden></div>
          </fieldset>`
          )
          .join("")}
        <div class="actions sticky">
          <span class="muted small" id="answered">0/${qs.length} answered</span>
          <button class="btn primary" type="submit">Submit answers</button>
        </div>
      </form>
      <div id="result"></div>
    `;

    const form = $("#quiz");
    const answered = () =>
      qs.filter((_, i) => $$(`input[name="q${i}"]:checked`, form).length > 0).length;
    form.addEventListener("change", (e) => {
      const name = e.target.name;
      const i = Number(name.slice(1));
      const boxes = $$(`input[name="${name}"]:checked`, form);
      if (qs[i].need > 1 && boxes.length > qs[i].need) e.target.checked = false;
      $("#answered").textContent = `${answered()}/${qs.length} answered`;
    });

    let submitted = false;
    leaveGuard = () => !submitted && answered() > 0;
    const grade = () => {
      if (submitted) return;
      const unanswered = qs.length - answered();
      submitted = true;
      clearInterval(timer);
      let correct = 0;
      const perModule = {};
      qs.forEach((item, i) => {
        const chosen = $$(`input[name="q${i}"]:checked`, form).map((x) => Number(x.value));
        const ok = item.opts.every((o, j) => o.correct === chosen.includes(j));
        if (ok) correct++;
        if (item.module) {
          const pm = (perModule[item.module.id] ||= { title: item.module.title, c: 0, t: 0 });
          pm.t++;
          if (ok) pm.c++;
        }
        const fs = $(`#q${i}`);
        fs.classList.add(ok ? "right" : "wrong");
        $$("label.option", fs).forEach((lab, j) => {
          lab.querySelector("input").disabled = true;
          if (item.opts[j].correct) lab.classList.add("is-correct");
          else if (chosen.includes(j)) lab.classList.add("is-wrong");
        });
        const ex = $(".explain", fs);
        ex.hidden = false;
        ex.innerHTML = `<strong>${ok ? "Correct." : "Incorrect."}</strong> ${esc(item.q.explain)}`;
      });
      $(".actions.sticky", form).remove();
      const pct = Math.round((correct / qs.length) * 100);
      onSubmit({ correct, total: qs.length, pct, perModule, unanswered });
    };

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const left = qs.length - answered();
      if (left && !confirm(`${left} question${left > 1 ? "s are" : " is"} unanswered. Submit anyway?`)) return;
      grade();
    });

    if (timed) {
      const end = Date.now() + timed * 60000;
      const tick = () => {
        const ms = end - Date.now();
        const el = $("#timer");
        if (!el) return clearInterval(timer);
        if (ms <= 0) {
          el.textContent = "Time's up";
          grade();
          return;
        }
        const m = Math.floor(ms / 60000);
        const s = Math.floor((ms % 60000) / 1000);
        el.textContent = `⏱ ${m}:${String(s).padStart(2, "0")} remaining`;
        el.classList.toggle("low", ms < 10 * 60000);
      };
      tick();
      timer = setInterval(tick, 1000);
    }
  }

  function showResult(html) {
    const r = $("#result");
    r.innerHTML = html;
    r.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function renderQuiz(m) {
    const qs = prepQuestions(m.quiz.map((q) => ({ q, module: m })));
    renderQuizBody(qs, {
      title: m.title,
      subtitle: `Module quiz · ${m.quiz.length} questions`,
      onSubmit: ({ correct, total, pct }) => {
        (S.quiz[m.id] ||= []).push({ pct, date: todayISO() });
        save();
        renderNav("quiz", m.id);
        const pass = pct >= PASS_PCT;
        const next = modules[modules.indexOf(m) + 1];
        showResult(`
          <section class="card result ${pass ? "pass" : "fail"}">
            <h2>${pct}% · ${correct}/${total} correct</h2>
            <p>${pass ? "Module complete. Nice work." : `You need ${PASS_PCT}% to complete this module. Review the explanations above and the lessons, then retry.`}</p>
            <div class="actions">
              <a class="btn ghost" href="#/module/${m.id}">Back to lessons</a>
              <button class="btn ghost" id="retry">Retake (reshuffled)</button>
              ${next ? `<a class="btn primary" href="#/module/${next.id}">Next module →</a>` : `<a class="btn primary" href="#/mock">Mock exam →</a>`}
              <a class="btn ghost" href="#/">Dashboard</a>
            </div>
          </section>`);
        $("#retry").addEventListener("click", () => renderQuiz(m));
      },
    });
  }

  /* ---------------- mock exam ---------------- */

  function mockQuestions() {
    const pool = modules.filter((m) => m.quiz.length);
    const size = Math.min(exam.questions, pool.reduce((a, m) => a + m.quiz.length, 0));
    // Largest-remainder apportionment so per-domain counts sum exactly to size.
    const totalWeight = pool.reduce((a, m) => a + m.weight, 0);
    const shares = pool.map((m) => {
      const exact = (m.weight / totalWeight) * size;
      return { m, n: Math.max(1, Math.floor(exact)), frac: exact - Math.floor(exact) };
    });
    let spare = size - shares.reduce((a, s) => a + s.n, 0);
    for (const s of shares.slice().sort((a, b) => b.frac - a.frac)) {
      if (spare <= 0) break;
      s.n++;
      spare--;
    }
    const picked = new Map();
    for (const { m, n } of shares) picked.set(m.id, shuffle(m.quiz).slice(0, Math.min(n, m.quiz.length)));
    // top up from leftovers until the target size is reached
    let count = [...picked.values()].reduce((a, l) => a + l.length, 0);
    const leftovers = shuffle(
      pool.flatMap((m) => m.quiz.filter((q) => !picked.get(m.id).includes(q)).map((q) => ({ q, m })))
    );
    while (count < size && leftovers.length) {
      const { q, m } = leftovers.pop();
      picked.get(m.id).push(q);
      count++;
    }
    return prepQuestions(pool.flatMap((m) => picked.get(m.id).map((q) => ({ q, module: m }))));
  }

  function renderMock() {
    const history = S.mock;
    app.innerHTML = `
      <section class="mod-head">
        <p class="eyebrow">Final</p>
        <h1>Full mock exam</h1>
        <p class="lead">Simulates the real exam: ${exam.questions} questions drawn from every module, weighted by domain,
        with a ${exam.minutes}-minute timer. Pass mark is an estimated ${exam.passScaled}/1000.</p>
      </section>
      <section class="card">
        <ul class="facts">
          <li><strong>${exam.questions}</strong> questions</li>
          <li><strong>${exam.minutes}</strong> minutes</li>
          <li><strong>${exam.passScaled}</strong> to pass</li>
          <li>Single and multiple response</li>
        </ul>
        <p class="muted small">The practice bank is smaller than the real item pool, so you'll see questions from the module quizzes.
        Treat this as a timing and stamina rehearsal. Real exam scaling isn't linear, so the score here is only an estimate.</p>
        <div class="actions"><button class="btn primary" id="start-mock">Start timed mock exam</button></div>
      </section>
      ${
        history.length
          ? `<section class="card"><h2>Previous attempts</h2>
              <table class="tbl"><thead><tr><th>Date</th><th>Score</th><th>Correct</th><th>Result</th></tr></thead><tbody>
              ${history
                .slice()
                .reverse()
                .map(
                  (h) => `<tr><td>${fmtDate(h.date)}</td><td>${h.scaled}</td><td>${h.correct}/${h.total}</td>
                  <td>${h.scaled >= exam.passScaled ? `<span class="tag ok">Pass</span>` : `<span class="tag bad">Below pass</span>`}</td></tr>`
                )
                .join("")}
              </tbody></table></section>`
          : ""
      }
    `;
    $("#start-mock").addEventListener("click", startMock);
  }

  function startMock() {
    const qs = mockQuestions();
    renderQuizBody(qs, {
      title: "Mock exam in progress",
      subtitle: `${exam.code} simulation · ${qs.length} questions`,
      timed: exam.minutes,
      onSubmit: ({ correct, total, pct, perModule }) => {
        const scaled = Math.round(pct * 10);
        S.mock.push({ date: todayISO(), correct, total, scaled });
        save();
        renderNav("mock");
        const pass = scaled >= exam.passScaled;
        const rows = Object.entries(perModule)
          .map(([id, r]) => ({ id, ...r, p: Math.round((r.c / r.t) * 100) }))
          .sort((a, b) => a.p - b.p);
        showResult(`
          <section class="card result ${pass ? "pass" : "fail"}">
            <h2>Estimated score: ${scaled} / 1000</h2>
            <p>${correct}/${total} correct · ${pass ? "Above the pass mark. You're in good shape." : `Below the ${exam.passScaled} pass mark. Focus on the weakest domains below.`}</p>
            <h3>By domain (weakest first)</h3>
            <table class="tbl"><thead><tr><th>Domain</th><th>Correct</th><th></th></tr></thead><tbody>
              ${rows
                .map(
                  (r) => `<tr><td>${esc(r.title)}</td><td>${r.c}/${r.t} (${r.p}%)</td>
                  <td><a href="#/module/${r.id}">Review</a></td></tr>`
                )
                .join("")}
            </tbody></table>
            <div class="actions">
              <a class="btn ghost" href="#/">Dashboard</a>
              <a class="btn ghost" href="#/mock">Mock exam home</a>
            </div>
          </section>`);
      },
    });
  }

  /* ---------------- practice exams ---------------- */

  function renderExam(e) {
    const history = S.exams[e.id] || [];
    const multi = e.questions.filter((q) => q.answer.length > 1).length;
    app.innerHTML = `
      <section class="mod-head">
        <p class="eyebrow">Full-length practice exam</p>
        <h1>${esc(e.title)}</h1>
        <p class="lead">${e.questions.length} questions across all domains, in a fixed order like a real exam form.
        Take it in exam mode for a timed rehearsal, or in practice mode with no clock.</p>
      </section>
      <section class="card">
        <ul class="facts">
          <li><strong>${e.questions.length}</strong> questions</li>
          <li><strong>${multi}</strong> multiple-response</li>
          <li><strong>${exam.minutes}</strong> minutes (exam mode)</li>
          <li><strong>${exam.passScaled}</strong> to pass (estimated)</li>
        </ul>
        <p class="muted small">Answers and explanations appear after you submit. The score is your percentage correct scaled to 1000,
        which only approximates the real exam's scaled score. Leaving the page mid-attempt discards your answers.</p>
        <div class="actions">
          <button class="btn primary" id="start-timed">Start exam mode (${exam.minutes} min)</button>
          <button class="btn ghost" id="start-practice">Practice mode (untimed)</button>
        </div>
      </section>
      ${
        history.length
          ? `<section class="card"><h2>Previous attempts</h2>
              <table class="tbl"><thead><tr><th>Date</th><th>Mode</th><th>Score</th><th>Correct</th><th>Result</th></tr></thead><tbody>
              ${history
                .slice()
                .reverse()
                .map(
                  (h) => `<tr><td>${fmtDate(h.date)}</td><td>${h.timed ? "Exam" : "Practice"}</td><td>${h.scaled}</td><td>${h.correct}/${h.total}</td>
                  <td>${h.scaled >= exam.passScaled ? `<span class="tag ok">Pass</span>` : `<span class="tag bad">Below pass</span>`}</td></tr>`
                )
                .join("")}
              </tbody></table></section>`
          : ""
      }
    `;
    $("#start-timed").addEventListener("click", () => startExam(e, true));
    $("#start-practice").addEventListener("click", () => startExam(e, false));
  }

  function startExam(e, timed) {
    const qs = prepQuestions(e.questions.map((q) => ({ q })), { fixed: true });
    const idx = EXAMS.indexOf(e);
    const next = EXAMS[idx + 1];
    renderQuizBody(qs, {
      title: e.title,
      subtitle: `${timed ? "Exam mode" : "Practice mode"} · ${qs.length} questions`,
      timed: timed ? exam.minutes : 0,
      letters: true,
      onSubmit: ({ correct, total, pct, unanswered }) => {
        const scaled = Math.round(pct * 10);
        (S.exams[e.id] ||= []).push({ date: todayISO(), correct, total, scaled, timed });
        save();
        renderNav("exam", e.id);
        const pass = scaled >= exam.passScaled;
        showResult(`
          <section class="card result ${pass ? "pass" : "fail"}">
            <h2>Estimated score: ${scaled} / 1000</h2>
            <p>${correct}/${total} correct${unanswered ? ` · ${unanswered} unanswered` : ""} ·
            ${pass ? "Above the pass mark." : `Below the ${exam.passScaled} pass mark. Read every explanation for the questions you missed.`}</p>
            <div class="actions">
              <button class="btn primary" id="only-wrong">Show only missed questions</button>
              <a class="btn ghost" href="#/exam/${e.id}">Exam home</a>
              ${next ? `<a class="btn ghost" href="#/exam/${next.id}">${esc(next.title)} →</a>` : ""}
              <a class="btn ghost" href="#/">Dashboard</a>
            </div>
          </section>`);
        const btn = $("#only-wrong");
        btn.addEventListener("click", () => {
          const on = $("#quiz").classList.toggle("only-wrong");
          btn.textContent = on ? "Show all questions" : "Show only missed questions";
          $("#quiz").scrollIntoView({ block: "start" });
        });
      },
    });
  }

  /* ---------------- theme ---------------- */

  const themeBtn = $("#theme");
  const applyTheme = (t) => {
    if (t) document.documentElement.dataset.theme = t;
    else delete document.documentElement.dataset.theme;
  };
  try {
    applyTheme(localStorage.getItem("ccdv-theme"));
  } catch {}
  themeBtn.addEventListener("click", () => {
    const dark =
      document.documentElement.dataset.theme === "dark" ||
      (!document.documentElement.dataset.theme && matchMedia("(prefers-color-scheme: dark)").matches);
    const t = dark ? "light" : "dark";
    applyTheme(t);
    try {
      localStorage.setItem("ccdv-theme", t);
    } catch {}
  });
  $("#menu").addEventListener("click", () => document.body.classList.toggle("nav-open"));
  app.addEventListener("click", () => document.body.classList.remove("nav-open"));

  route();
})();
