# Building a Self-Healing Locator Framework for Black-Box UI Testing

UI automation rarely fails because the user journey changed.

More often, it fails because a locator changed.

A CMS update renames a button id. A frontend release reshuffles markup. A client-owned website changes without warning. Suddenly, the test that was correctly trying to click **Login** is broken because `#login-button-old` no longer exists.

The flow is still valid. The locator is not.

That distinction matters.

This project explores a lightweight self-healing locator framework that keeps the test flow unchanged, but makes locator resolution adaptive.

The sample repo is here:

https://github.com/MrNewDelhi/self-healing-locator-framework

## The Problem

In black-box testing, we often do not control the application under test.

This is especially painful for CMS-based websites where content, labels, page structure, and attributes can change without a coordinated release note for QA automation teams.

The usual result is familiar:

- scripts fail
- engineers triage screenshots and traces
- locators are repaired by hand
- the same failure pattern returns after the next CMS or frontend update

This creates a maintenance loop where the test suite becomes expensive not because the business flows are unstable, but because the element discovery strategy is brittle.

The goal of this framework is simple:

> Do not change the test flow. Only heal the locator used at that step.

## The Core Idea

Instead of hardcoding one locator and failing immediately, the framework stores a local cache of locator candidates for each target element.

Each cache entry tracks:

- target name, such as `login button`
- page key, such as `https://www.saucedemo.com/`
- stable element hash
- top locator candidates
- confidence score
- attempts
- successes
- failures
- cache hits
- cache misses
- last and average resolution time

The test does not say:

```ts
await page.locator("#login-button").click();
```

It says:

```ts
const login = await healing.find("login button", [staleLocator]);
await login.locator.click();
```

The test still clicks the login button. The difference is that locator selection becomes a runtime decision backed by evidence.

## The Pipeline

The framework follows this flow:

1. The test asks for a target element, for example `login button`.
2. The framework checks the local cache.
3. If cached candidates exist, it tries them in confidence order.
4. If cached locators fail, it scans the visible page.
5. It extracts component snapshots from the DOM.
6. A locator generator ranks the top 5 candidates.
7. The framework tries each candidate.
8. The first working locator is used.
9. The cache is updated with confidence metrics.

In Mermaid form:

```mermaid
flowchart LR
  A[Test asks for target: login button] --> B{Cache lookup}
  B -->|hit| C[Try cached top locators]
  C -->|works| D[Run same test flow]
  C -->|fails| E[Scan visible page]
  B -->|miss| E
  E --> F[Extract component snapshots]
  F --> G[LLM or heuristic locator generator]
  G --> H[Top 5 locator candidates]
  H --> I[Validate one by one]
  I -->|works| J[Increase confidence and persist hash]
  I -->|none work| K[Fail with attempted locator report]
```

## What Gets Scanned

For a website, the framework can scan the page DOM and collect useful element signals:

- tag name
- visible text
- role
- ARIA label
- placeholder
- test id or data-test
- id
- name
- type
- class list
- CSS path

It then creates a stable hash from the element’s shape.

The hash is not meant to be a perfect identity forever. It is a practical fingerprint that helps answer:

> Does this candidate still look like the same kind of element we previously used?

## Locator Generation

In the sample repo, I used a heuristic generator so the project can run without any API key.

The generator looks at the target name and ranks candidates such as:

- role locator
- test id locator
- label locator
- placeholder locator
- text locator
- CSS locator

Example output:

```ts
[
  {
    strategy: "role",
    value: "button",
    name: "Login",
    score: 0.91,
    reason: "Accessible role matched the target intent."
  },
  {
    strategy: "css",
    value: "#login-button",
    score: 0.88,
    reason: "Element id was present in the scanned component."
  }
]
```

The important part is the contract.

The same interface can be backed by an LLM:

```ts
interface LocatorGenerator {
  generate(input: {
    targetName: string;
    snapshots: ElementSnapshot[];
  }): Promise<LocatorCandidate[]>;
}
```

That means the framework can later send the page component snapshots and target name to an LLM and ask it to return the top 5 locator candidates with scores and reasons.

## Confidence Metrics

A self-healing cache should not be just a drawer full of strings.

It should behave like evidence.

When a locator works, confidence increases. When a cached locator fails, confidence decreases. Cache hits and misses are tracked separately so teams can see whether the system is genuinely reducing maintenance.

Useful metrics include:

- cache hit rate
- healed miss rate
- manual triage rate
- average resolution time
- locator confidence by target
- most unstable pages
- most frequently healed elements

For example:

```mermaid
pie title Locator Resolution Outcomes
  "Cache hits" : 65
  "Healed misses" : 25
  "Manual triage" : 10
```

Over time, this tells you whether your test suite is becoming more resilient or merely hiding flaky behavior.

## Cache Hit and Miss Logic

The cache logic is intentionally conservative.

On a cache hit:

- load cached candidates
- try the highest-confidence candidate first
- if it works, increase confidence
- if it fails, record a miss and continue to page scanning

On a cache miss:

- scan visible elements
- generate locator candidates
- validate them one by one
- store the winning candidate
- persist the updated cache locally

This keeps the system explainable. Every healed locator can be traced back to the candidates that were tried and the reason the selected candidate won.

## Why This Helps

The biggest benefit is not that tests magically never fail.

They still should fail when the product flow is broken.

The benefit is that tests do not fail just because a locator became stale while the user journey remained valid.

This reduces:

- repetitive locator triage
- manual maintenance after CMS changes
- noisy failures in CI
- time spent inspecting screenshots for obvious locator drift

It also gives QA and engineering teams a better signal:

> Did the feature break, or did the locator break?

Those are very different problems.

## Web vs Android and iOS

The web case is the easiest version of this idea.

On a website, the whole page DOM can usually be scanned. That means the framework can inspect many possible candidates at once.

Mobile is different.

With Android and iOS automation through Appium, the accessibility tree generally exposes what is available in the current viewport. If an element is off-screen, inside a collapsed panel, or behind a navigation step, it will not be discovered until the app reaches that state.

For mobile, the same methodology still works, but the scan strategy changes:

- scan the current viewport
- scroll in controlled chunks
- collect accessibility snapshots
- rank candidates per viewport
- only heal the locator for the intended step
- do not change the test flow automatically

That last point is important.

A self-healing locator system should not invent a new journey through the app. It should only help find the intended element when the test flow is already at the correct step.

## Running the Sample

The repo uses Playwright and Sauce Demo as the sample website.

Install dependencies:

```bash
npm install
npx playwright install chromium
```

Run tests:

```bash
npm test
```

Run the standalone demo:

```bash
npm run demo
```

The demo intentionally starts with a stale locator:

```ts
const brokenSeed = {
  strategy: "css",
  value: "#login-button-before-cms-redesign",
  score: 0.2,
  reason: "Simulates a stale locator left behind after an unannounced page change."
};
```

The framework scans the page, finds a working replacement locator, clicks the login button, and updates the local cache.

Example result:

```json
{
  "target": "login button",
  "cacheHit": false,
  "healed": true,
  "selectedLocator": {
    "strategy": "css",
    "value": "#login-button",
    "score": 0.92,
    "reason": "Element id was present in the scanned component."
  },
  "confidence": 0.93,
  "attempted": 3
}
```

## Tutorial Video

I also created a short HyperFrames tutorial video in the repo.

The source lives in:

```text
tutorial/index.html
tutorial/DESIGN.md
```

The rendered MP4 lives in:

```text
tutorial/renders/self-healing-locator-tutorial.mp4
```

Validation completed with:

```bash
npm run typecheck
npm test
npm run demo
npm run hyperframes:lint
npm run hyperframes:inspect
npm run hyperframes:render
```

## Final Thoughts

Self-healing locators are not a replacement for good test design.

They are a maintenance layer.

The framework should not hide real product defects, skip failed assertions, or invent new flows. It should simply recognize when the target element is still present but the old locator is stale.

For black-box testing, client-owned products, CMS-driven pages, and large automation suites, that can remove a lot of repetitive triage work.

The practical win is flexibility without losing control:

- the test flow stays readable
- the locator strategy becomes adaptive
- confidence metrics make healing observable
- failures remain explainable

That is the kind of automation resilience worth building.
