# Up Test

A plain-text team website. Content lives in Markdown files, GitHub Pages builds the site, and Pages CMS gives the team an editor so nobody has to write HTML.

## For the team: how to edit

1. Go to **https://app.pagescms.org** and sign in with your GitHub account.
2. Open **samkiller222/up-test**.
3. Click **Pages** to edit a page, or **Site settings** for the header, notice bar, menu and footer.
4. Hit **Save**. The site updates within a minute or two.

To add a new page, click **Add an entry** under Pages, give it a title, a menu position and a web address like `/contact/`.

## Where things live

| Path | What it is |
|------|------------|
| `pages/*.md` | Each guide page (phases, steps, cards) |
| `_data/settings.yml` | Header, notice bar, menu, footer |
| `_layouts/page.html` | The one HTML template (only Sam needs this) |
| `assets/style.css` | Styling |
| `.pages.yml` | Editor setup |

## One-time setup

- **Turn on the site:** repo Settings → Pages → Source: *Deploy from a branch* → `main` / `(root)` → Save.
- **Give teammates access:** repo Settings → Collaborators → add each person (they need write access to save).
