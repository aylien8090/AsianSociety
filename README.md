# Asian Society ticket payments

This is a Cloudflare Pages site. A person registers, receives a reference such as `CN-7K2M`, and pays manually through Revolut using that reference. The organiser checks Revolut, opens `/admin.html`, marks the matching reference paid, then sends the confirmation through Resend.

## Before publishing

1. The site is currently set to the €8 early-bird price and Revolut tag `@siddiquico`. Change the `PAYMENT` object in `index.html` when you move to another ticket tier.
2. Install Node.js 20+ then run `npm install`.
3. Log in to Cloudflare: `npx wrangler login`.
4. Create the database: `npx wrangler d1 create asian-society-tickets`. Copy its `database_id` into `wrangler.jsonc`.
5. Create its tables: `npx wrangler d1 execute asian-society-tickets --remote --file=migrations/0001_tickets.sql`.
6. In Cloudflare Dashboard, create a Pages project from your GitHub repository. Build command: leave blank. Build output directory: `.`. In **Settings → Bindings**, add a D1 binding called `TICKETS_DB` pointing to this database.
7. In **Settings → Environment variables**, add encrypted secrets:
   - `ADMIN_PASSWORD`: a long unique password for `/admin.html`
   - `RESEND_API_KEY`: an API key from Resend
   - `FROM_EMAIL`: a verified Resend sender, e.g. `Asian Society <tickets@yourdomain.com>`
8. In Resend, verify the domain used by `FROM_EMAIL` and add its DNS records in Cloudflare. Do not use an unverified sender address.

## Using it on the night

1. Check the Revolut transfer note for a code, for example `CN-7K2M`.
2. Visit `https://your-site.pages.dev/admin.html` and enter `ADMIN_PASSWORD`.
3. Find that code, choose **Mark paid**, then **Send email**.

The frontend does not hold any password, Resend key, or payment secret. `admin.html` asks for the password each time; use it only on a trusted organiser device and do not share its URL/password publicly.

## GitHub

Create an empty GitHub repository, then from this folder run:

```powershell
git init
git add .
git commit -m "Add Cloudflare ticket payment flow"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/YOUR-REPO.git
git push -u origin main
```
