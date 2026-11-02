# CCDV Prep

A static study site for the **Claude Certified Developer – Foundations (CCDV-F)** exam.

## Features

- **Step-by-step docs with checklists**: 9 modules (orientation plus the 8 exam domains), 27 lessons, and a checklist for each lesson.
- **Personal timeline**: choose 1 week, 2 weeks or a custom exam date. The planner spreads the lessons across the available days, balancing study minutes in order, then adds a review day (when there's room) and practice-exam days at the end (about a third of the plan, up to one per exam). If you fall behind, **Rebalance from today** spreads the remaining work over the days you have left.
- **Module quizzes**: 76 exam-style questions (single and multiple response) with explanations. Score 72%+ to complete a module.
- **4 full-length practice exams**: 53 questions each, in exam mode (120-minute timer) or practice mode (untimed). After you submit you get an estimated score, explanations, a filter that shows only the questions you missed, and your attempt history.
- **Domain mock**: 53 questions split to match the real domain weights (largest-remainder rounding), a 120-minute timer and an estimated scaled score with a per-domain breakdown.
- Progress is saved in the browser (`localStorage`). Includes dark mode and works on mobile.

## Run

There's no build step. Open `index.html` in a browser, or serve the folder:

```bash
cd ccdv && python3 -m http.server 8080   # http://localhost:8080
```

To deploy, upload the folder to any static host (Hostinger, Netlify, GitHub Pages, etc.).

## Structure

```
index.html        page shell
css/styles.css    styles (light/dark tokens, responsive)
js/content.js     all study content: modules, lessons, checklists, questions
js/exams.js       practice exams (generated, do not edit by hand)
js/app.js         router, planner, progress tracking, quiz and exam engine
data/exams/       source JSON for the practice exams (exam-1.json … exam-4.json)
tools/build_exams.py  converts data/exams/*.json into js/exams.js
```

## Practice exams

To add or update an exam, drop a JSON file into `data/exams/` named `exam-N.json` and regenerate:

```bash
python3 tools/build_exams.py
```

The converter accepts options as `["A) text", ...]` or `{"A": "text", ...}`, and answers as `correct_answer: "B"` or `correct_answers: ["A", "C"]`. It stops with an error if an answer letter doesn't match an option.

## Editing content

Everything lives in `js/content.js`. To add a question, append it to a module's `quiz` array:

```js
{ q: "Question text", options: ["A", "B", "C", "D"], answer: [1], explain: "Why B is right." }
```

Use two or more indexes in `answer` for a multiple-response item, and put "(Select N)" in the question text.

The exam blueprint figures (domain weights, 53 questions, 120 min, 720/1000) come from third-party summaries as of November 2026. Check them against Anthropic's official exam guide.
