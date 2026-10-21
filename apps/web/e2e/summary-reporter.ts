// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Playwright reporter for CI (`playwright.config.ts`): appends the run's outcome to the GitHub job summary
 * (`GITHUB_STEP_SUMMARY`): the counts, the wall time with the number of workers, and every flaky test (failed, then
 * passed on its retry), so `retries` never hides a flake.
 */
import { appendFileSync } from 'node:fs';
import type { FullConfig, FullResult, Reporter, Suite } from '@playwright/test/reporter';

export default class SummaryReporter implements Reporter {
  private root: Suite | undefined;
  private workers = 0;

  onBegin(config: FullConfig, suite: Suite): void {
    this.root = suite;
    this.workers = config.workers;
  }

  onEnd(result: FullResult): void {
    const file = process.env['GITHUB_STEP_SUMMARY'];
    if (file === undefined || this.root === undefined) return;
    const counts = { expected: 0, unexpected: 0, flaky: 0, skipped: 0 };
    const flaky: string[] = [];
    for (const test of this.root.allTests()) {
      const outcome = test.outcome();
      counts[outcome] += 1;
      if (outcome === 'flaky') flaky.push(`- ${test.titlePath().filter(Boolean).join(' › ')}`);
    }
    const seconds = Math.round(result.duration / 1000);
    const lines = [
      '### E2E',
      '',
      `**${result.status}**: ${counts.expected} passed, ${counts.flaky} flaky, ${counts.unexpected} failed, ` +
        `${counts.skipped} skipped in ${Math.floor(seconds / 60)} min ${seconds % 60} s on ${this.workers} workers.`,
      '',
      ...(flaky.length === 0 ? [] : ['Flaky (passed only on a retry; fix them):', '', ...flaky, '']),
    ];
    appendFileSync(file, `${lines.join('\n')}\n`);
  }
}
