# Security policy

write.financial stores people's financial data, so we treat security reports as our top priority. Thank you for helping keep users and self-host operators safe.

## Supported versions

The project is pre-1.0. Only the latest code on the `main` branch (and, once releases exist, the latest release) receives security fixes. Older commits and forks are not supported; please check that an issue still exists on `main` before reporting it.

| Version | Supported |
|---|---|
| `main` / latest release | Yes |
| Anything older | No |

## Reporting a vulnerability

**Do not open a public issue, pull request, or discussion for a security problem.** Report it privately through either channel:

- **Email:** [security@write.financial](mailto:security@write.financial)
- **GitHub private vulnerability reporting:** the repository's **Security** tab → **Report a vulnerability** ([direct link](https://github.com/avtara/write.financial/security/advisories/new))

Please include:

- A description of the issue and its impact (what an attacker can read, change, or do).
- The affected component (for example web app, worker, Docker image, self-host compose, a specific package) and the commit or version you tested.
- Step-by-step reproduction instructions or a proof of concept. Use your own test accounts and data.
- Any configuration that matters (`DEPLOYMENT_MODE`, registration mode, reverse proxy, browser).
- Whether you want to be credited, and under which name.

Write in English or Bahasa Indonesia. Never send real user data, real credentials, or other people's financial information in a report.

## What happens next

| Step | Target |
|---|---|
| Acknowledge your report | Within **3 business days** |
| Initial assessment (validity and severity) | Within **7 business days** |
| Fix for a **critical** issue | Within **7 days** of confirmation |
| Fix for a **high** issue | Within **30 days** |
| Fix for a **medium** issue | Within **60 days** |
| Fix for a **low** issue | Within **90 days** or the next planned release |

Severity is assessed with [CVSS v4.0](https://www.first.org/cvss/v4.0/) and the threat model in [PRD §9.1](docs/PRD.md#91-data-storage-security-public-app) (cross-tenant data access, leaks of the database, disks, or backups, secrets in logs, account takeover, over-sharing with third parties). We keep you updated at least every 14 days until the issue is resolved. These are targets from a small team, not contractual guarantees.

## Coordinated disclosure

- We fix the issue privately, then publish a GitHub Security Advisory (with a CVE when appropriate) together with the fixed release, and credit you unless you prefer otherwise.
- Please keep the details private until the advisory is published or 90 days have passed since your report, whichever comes first. If a fix needs more time, we will explain why and agree on a new date with you.
- If the issue is being actively exploited, we may publish mitigations earlier.
- Self-host operators are told through the advisory and the release notes; update promptly.

## Scope

**In scope**

- The code in this repository: web app, worker, packages, Docker image, self-host compose files, and the default configuration they ship with (for example registration mode, mandatory admin 2FA, key generation).
- The official cloud instance at `write.financial` and `app.write.financial`, within the safe-harbor rules below.

**Self-host vs cloud.** Each self-hosted instance is run by its own operator, who is the data controller for that instance ([PRD D19](docs/PRD.md#12-default-decisions--questions-for-the-product-owner)); the project does not receive data from self-hosted instances. Report vulnerabilities in the software to us. Problems that exist only because of one operator's deployment (an exposed database port, a weak server password, a missing TLS certificate) belong to that operator; please contact them directly, not us, and do not test instances you do not own.

**Out of scope**

- Instances operated by third parties, and testing them without their operator's permission.
- Social engineering, phishing, or physical attacks against maintainers, users, or providers.
- Denial-of-service or load testing, spam, and automated scanning that degrades the cloud service.
- Reports from automated tools without a demonstrated impact, missing best-practice headers without an exploit, and self-XSS.
- Vulnerabilities in third-party services we integrate with (Google, LLM providers, market-data APIs); report those to the vendor. Vulnerabilities in a dependency that affect write.financial are in scope.

## Safe harbor

We will not pursue or support legal action against you for security research that is done in good faith and within this policy, meaning that you:

- Only access your own accounts and data, or data you have explicit permission to access, and stop as soon as you reach other users' data. Do not keep, copy, or share it.
- Do not degrade the service, destroy data, or attempt to persist access.
- Report the issue to us promptly and keep it confidential as described above.

If a third party takes legal action against you for research that followed this policy, we will make it known that your actions were authorized by us. If you are unsure whether something is allowed, ask at [security@write.financial](mailto:security@write.financial) first.

## Bug bounty

There is no paid bug bounty program yet. We are grateful for every report and will credit you in the advisory and release notes if you wish.
