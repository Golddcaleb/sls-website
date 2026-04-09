# SLS Priorities

*Last updated: April 2026*

## Current Top 5

1. **Deploy website**  
   Switch signallogicsystems.com DNS from Lovable to Netlify.  
   Status: In progress

2. **Build processing engine**  
   Backend logic for Job Flow Monitor: accepts CSV input, returns diagnostic output without exposing the calculation engine.  
   Status: Phase 1 (browser-based demo engine) complete and polished — constraint chart now horizontal, customer name displayed in report header, raw job data scrubbed from memory post-processing. Synthetic demo CSV (Midwest Precision Fabricating, 60 jobs) created for sales demos. Phase 2 (Netlify Function with HMAC auth) is next step before first paying client.

3. **Start outreach**  
   Send follow-up to AMEND Consulting. Begin broader outreach to consulting firms.  
   Status: Initial contact made with AMEND — follow-up pending

4. **Land first customer**  
   Target: within 30 days of April 2026.  
   Status: No current paying customers

5. **Record VSL**  
   Homepage video placeholder needs real content.  
   Status: Not started

## Known Issues (Non-Urgent)

- **Inbound email needs troubleshooting** — MX records are live in Netlify but confirmation emails to hello@signallogicsystems.com are not arriving (e.g. GitHub). Likely Google Workspace quarantine or spam filter setting. Revisit after first customer.

## Next Actions

- Connect GitHub repo to Netlify and verify live deployment
- Test dashboard.js with a real JobBOSS CSV export using the demo CSV as a baseline
- Build Phase 2: Netlify Function endpoint with HMAC-SHA256 auth
- Follow up with AMEND Consulting
