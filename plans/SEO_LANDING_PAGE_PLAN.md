# Landing Page & SEO Plan

## Current State Assessment

**URL**: https://turutupa.github.io/yames/  
**Hosting**: GitHub Pages (via `.github/workflows/pages.yml` deploying `docs/` folder)  
**Custom domain**: None (no CNAME file)

### What's Already Done Well

| Area | Status | Notes |
|------|--------|-------|
| Meta title | ✅ Strong | "Yames — Free Desktop Metronome App for Musicians \| macOS, Windows, Linux" |
| Meta description | ✅ Good | Hits key features + platforms |
| Open Graph tags | ✅ Complete | Title, description, image (1200×630), locale |
| Twitter Card | ✅ Complete | Summary large image |
| Structured Data | ✅ Excellent | SoftwareApplication + WebSite + FAQPage + BreadcrumbList |
| Keywords meta | ✅ Comprehensive | 20+ relevant terms |
| Sitemap | ✅ Present | Single page, weekly freq |
| robots.txt | ✅ Present | Allow all |
| Canonical URL | ✅ Set | Points to current GitHub Pages URL |
| Performance | ✅ Good | Preloaded fonts/CSS/LCP image, minimal JS |
| Screenshot showcase | ✅ Good | All 10 themes × multiple tabs, interactive |
| Platform downloads | ✅ Good | Auto-detects OS, CLI install commands |
| FAQ schema | ✅ Excellent | 8 questions covering key queries |

### What's Missing / Can Improve

| Gap | Impact | Effort |
|-----|--------|--------|
| **No custom domain** | Looks amateur, hurts brand recall, harder to market | Low (buy domain + CNAME) |
| **Single page only** | Can't rank for multiple keyword clusters | Medium |
| **No blog/content** | Missing long-tail SEO ("how to practice with metronome", "best metronome for guitar", etc.) | High (ongoing) |
| **softwareVersion outdated** | Shows "0.4.1" in structured data, actual is 0.5.2 | Trivial fix |
| **No Google Search Console** | Can't track impressions, clicks, keyword rankings | Low |
| **No analytics** | Can't measure traffic or user behavior on site | Low (see telemetry section) |
| **No testimonials/social proof** | GitHub stars, user quotes would build trust | Low-Medium |
| **Missing pages**: changelog, features deep-dive, comparison | More indexable content = more keywords | Medium |
| **No video embed** | A 30-second demo would massively improve engagement + time-on-page | Medium |
| **Image alt text** | Screenshots use generic "App screenshot" — should be descriptive | Trivial |
| **No link building** | Not listed on alternativeto.net, product directories, music forums | Ongoing effort |

---

## Custom Domain: Recommendation

**Yes, get one.** It's $10-12/year and gives you:

1. **Brand credibility** — `yames.app` or `yames.io` looks professional
2. **SEO permanence** — if you ever move off GitHub Pages, your URLs survive
3. **Marketing materials** — "download at yames.app" vs "turutupa.github.io/yames"
4. **Email** — can set up `hello@yames.app` for user support later

### Suggested domains (check availability)

| Domain | Why |
|--------|-----|
| `yames.app` | Clean, modern (.app is HTTPS-enforced, great for software) |
| `yames.io` | Tech-friendly, short |
| `getyames.com` | Classic pattern if yames.com is taken |
| `yames.dev` | Developer-oriented |

**Registrars**: Cloudflare Registrar (cheapest, no markup), Namecheap, or Google Domains.

### Setup (15 minutes)

1. Buy domain
2. Add `CNAME` file to `docs/` with the domain name
3. Configure DNS: CNAME record pointing to `turutupa.github.io`
4. Enable HTTPS in GitHub Pages settings
5. Update all canonical URLs, sitemap, structured data, OG tags

---

## Immediate SEO Fixes (no domain needed)

### 1. Update structured data version
```json
"softwareVersion": "0.5.2"
```

### 2. Better image alt texts
```html
<img src="img/drill/obsidian-drill.png" 
     alt="Yames metronome drill practice mode showing progressive BPM training with Obsidian dark theme" />
```

### 3. Add GitHub stars badge / social proof
```html
<span class="stars">★ 42 on GitHub</span>
```
Fetch dynamically from GitHub API (already fetching releases).

### 4. Submit to Google Search Console
- Verify ownership via GitHub Pages DNS or HTML meta tag
- Submit sitemap
- Monitor indexing status

---

## Phase 2: Additional Pages (if custom domain acquired)

| Page | Target Keywords | Purpose |
|------|----------------|---------|
| `/features` | "metronome with speed ramp", "zen mode metronome", "floating metronome widget" | Deep-dive on features with screenshots |
| `/download` | "download free metronome", "metronome for mac", "metronome for windows" | Dedicated download page (better than just a button) |
| `/changelog` | — | Shows active development, good for returning visitors |
| `/compare` | "yames vs pro metronome", "best free metronome 2026" | Comparison table against competitors |
| `/guides/practice-with-metronome` | "how to practice with metronome", "metronome exercises" | Content marketing, long-tail SEO |

### Content Ideas for Blog/Guides

- "5 Metronome Exercises Every Guitarist Should Know"
- "How to Practice Odd Time Signatures (5/4, 7/8)"
- "Why Desktop Metronomes Are Better Than Browser-Based Ones"
- "Speed Building: How to Use Drill Mode to Increase Your BPM"

These pages would attract organic traffic from musicians searching for practice tips, then funnel to download.

---

## Phase 3: Distribution & Backlinks

| Action | Impact | Effort |
|--------|--------|--------|
| Submit to AlternativeTo.net | High (people search for alternatives to Pro Metronome) | 15 min |
| Submit to Product Hunt | High (one-time spike + permanent listing) | 1-2 hours |
| Post on r/Guitar, r/WeAreTheMusicMakers, r/musicproduction | Medium | 30 min each |
| List on awesome-rust, awesome-tauri GitHub lists | Medium (backlinks + developer traffic) | PR submission |
| Homebrew tap visibility | Already done ✅ | — |
| Submit to Snapcraft store page optimization | Low-Medium | 30 min |
| Video demo on YouTube | High (YouTube SEO + embeddable) | 2-3 hours |

---

## Analytics for the Landing Page

For the website specifically (separate from in-app telemetry):

| Tool | Privacy | Cost | Setup |
|------|---------|------|-------|
| **Plausible** | GDPR-compliant, no cookies, lightweight (< 1KB) | $9/mo or self-host free | Script tag |
| **Umami** | Self-hosted, privacy-focused | Free (self-host) | Deploy + script tag |
| **Cloudflare Analytics** | Privacy-first, no JS needed | Free (if using CF DNS) | DNS-level |
| **GoatCounter** | Privacy-aware, no cookies | Free for non-commercial | Script tag |

**Recommendation**: If you get a Cloudflare domain, their free analytics (DNS-level, no JS needed) is the easiest win. Otherwise Plausible or GoatCounter.

---

## Implementation Priority

1. **Buy domain** (yames.app or similar) — 15 min
2. **Set up CNAME + DNS** — 15 min
3. **Fix structured data version** — 5 min
4. **Google Search Console setup** — 30 min
5. **Add Cloudflare/Plausible analytics to landing page** — 15 min
6. **Submit to AlternativeTo + Product Hunt** — 2 hours
7. **Additional pages (features, download, changelog)** — 1-2 days
8. **Content/guides** — ongoing

## Effort Estimate

- Domain + DNS + CNAME + URL updates: **1-2 hours**
- SEO fixes (version, alt text, Search Console): **1 hour**
- Directory submissions: **2-3 hours**
- Additional pages: **1-2 days**
- Blog/content: **ongoing, 2-4 hours per article**
