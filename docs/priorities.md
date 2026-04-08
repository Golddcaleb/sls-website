# SLS Priorities

*Last updated: April 2026*

## Current Top 5

1. **Deploy website**  
   Switch signallogicsystems.com DNS from Lovable to Netlify.  
   Status: In progress

2. **Build processing engine**  
   Backend logic for Job Flow Monitor: accepts CSV input, returns diagnostic output without exposing the calculation engine.  
   Status: Phase 1 (browser-based demo engine) complete — dashboard.html + dashboard.js built with constraint ID, revenue at risk, cascade analysis, and priority ranking. Architecture documented in docs/jfm-architecture.md. Phase 2 (Netlify Function with HMAC auth) is next step before first paying client.

3. **Start outreach**  
   Send follow-up to AMEND Consulting. Begin broader outreach to consulting firms.  
   Status: Initial contact made with AMEND — follow-up pending

4. **Land first customer**  
   Target: within 30 days of April 2026.  
   Status: No current paying customers

5. **Record VSL**  
   Homepage video placeholder needs real content.  
   Status: Not started

## Next Actions (from this session)

- Test dashboard.js with a real JobBOSS CSV export
- Build Phase 2: Netlify Function endpoint with HMAC-SHA256 auth
- Resolve open questions in docs/jfm-architecture.md:
  - Column mapping fallback UI behavior
  - Stage ordering configuration approach
  - Phase 2 report delivery method (inline JSON vs. signed URL)
  - Customer ID encoding for multi-tenant use
  - Define minimum viable CSV column set
