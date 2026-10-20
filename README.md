# Up-test — Residence Guide

A team-editable website. Content lives in plain files in this repo, GitHub Pages builds the site, and anyone with access can edit it **directly on the website**.

Live site: https://samkiller222.github.io/Up-test/

## For the team: editing on the site

**First time (once per browser)**

1. Ask Sam to add you as a collaborator on this repo, then accept the email invite.
2. Open https://samkiller222.github.io/Up-test/#edit and click **✏️ Edit page** (bottom right).
3. Follow the steps in the box to create a GitHub token (about 2 minutes), then paste it in and click **Connect**.

After that, the **Edit page** button always shows for you on that browser.

**Editing**

- Click any text to change it. Press **Enter** when you're done with a line.
- Use **▲ ▼ ✕** next to a phase, step, card or menu item to move or remove it. Use the **+ Add** buttons to add new ones.
- To change where a menu item, card button or link goes, click it and edit the address in the little box.
- To turn words in a step into a link, select them and click **🔗 Make selected text a link**.
- Click **Save** (or press Ctrl+S). The live site updates in about a minute.

**Sign out** forgets your token on that browser, which is useful on shared computers.

## Backup editor

Pages CMS also works: https://app.pagescms.org → sign in with GitHub → **Up-test**.

## Where things live

| Path | What it is |
|------|------------|
| `pages/*.md` | Each guide page (phases, steps, cards) |
| `_data/settings.yml` | Header, notice bar, menu, footer |
| `_layouts/page.html` | The HTML template |
| `assets/style.css` | Site styling |
| `assets/edit.js`, `assets/edit.css` | The on-page editor |
| `.pages.yml` | Pages CMS setup |
