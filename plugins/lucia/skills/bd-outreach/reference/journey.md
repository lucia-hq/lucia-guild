# BD outreach — end-to-end command sequence

The full prospecting loop, in order. Replace placeholders. All commands run
from the skill's `scripts/` directory (or use an absolute path to `bd.mjs`).

```
# 1. Start today's journey (shows scan + send budgets, your from-address)
node bd.mjs start --sector "fashion e-commerce" --geo "US" --size "mid-market"
#   -> journeyId: bdj_...   from: <username>@getlucia.ai   scans 0/5

# 2. (You research and PROPOSE a shortlist; the Lucian picks — no command.)
#    Private commercial/consumer brands only — never government, healthcare,
#    emergency, education/children, charities, or political/religious orgs.

# 3. Recon each shortlisted prospect (read-only, no scan, no cost)
node bd.mjs recon https://www.exampleshop.com

# 4. Scan up to FIVE prospects (server enforces the cap), poll each to done
node bd.mjs scan bdj_... https://www.exampleshop.com      # -> targetId: bdt_...
node bd.mjs status bdt_...                                 # repeat until status: done
node bd.mjs summary bdt_...                                # findings + score + preview + evidence siteId

# 5. Pitch assets
node bd.mjs email bdt_... --region us                      # subject + body + bodyHash
node bd.mjs deck-data bdt_...                              # JSON evidence -> build the PPTX with the pptx skill

# 6. Send (gated — off until the operator enables it)
node bd.mjs recipient bdt_... buyer@exampleshop.com --name "Sam Buyer"
node bd.mjs send bdt_... --hash <bodyHash from step 5> --region us

# Any time: your BD dashboard
node bd.mjs mine
```

## Notes
- `--region` (us|uk|eu) sets the legal-context line in the email; omit for a
  combined US/UK/EU framing.
- The recipient's domain must match the scanned prospect's registrable domain.
- `send` returns `blocked_disabled` (a friendly message) until a Lucia operator
  completes the Cloudflare email setup and arms the kill-switch. That is normal.
- One successful send per prospect domain — re-sends are rejected.
