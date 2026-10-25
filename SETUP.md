# Seedline setup (simple steps)

You only **need Part 1**. Part 2 is optional — skip it unless you want an admin dashboard.

---

## Part 1 — Put the app online (GitHub Pages, free)

1. Open your repository: https://github.com/fikayomi2009/Seedline
2. Tap **Settings** (on a phone, it may be under the **⋯** menu at the top).
3. In the left menu, tap **Pages**.
4. Under **Build and deployment → Source**, choose **Deploy from a branch**.
5. Under **Branch**, choose **main**, and next to it choose **/ (root)**.
6. Tap **Save**.
7. Wait 1–3 minutes, then refresh the Pages screen. You'll see a link. It will be:

   **https://fikayomi2009.github.io/Seedline/**

### Install it on your Android phone
1. Open that link in **Chrome**.
2. Tap the **⋮** menu → **Add to Home screen** (or **Install app**).
3. Open Seedline from your home screen. Play a message and lock your screen — the controls show on the lock screen.

### When you change files later
GitHub Pages updates by itself a minute or two after each change. If the installed app still shows the old version, close it fully and open it again.

---

## Part 2 — (Optional) Admin dashboard with Supabase

This lets one admin (you) edit titles/topics, hide messages, add messages and make featured playlists **for everyone**. Without it, the Admin page just says "Not configured yet" and the rest of the app works normally.

### A. Create the project
1. Go to https://supabase.com and sign up (free plan is fine).
2. Tap **New project**. Give it a name (e.g. `seedline`), set a database password (save it somewhere safe), pick a region close to you (e.g. *West EU* or *Central EU*), and create it. Wait until it finishes.

### B. Create the tables and security rules
1. In your project, open **SQL Editor** → **New query**.
2. Open the file `supabase/schema.sql` from this repository, copy **everything**, paste it into the editor.
3. Tap **Run**. You should see "Success".

### C. Turn off public sign‑ups (important)
1. Go to **Authentication** → **Sign In / Providers** (on some versions: **Authentication → Providers → Email**, or **Authentication → Settings**).
2. Turn **OFF** "Allow new users to sign up".
3. Keep **Email** sign‑in enabled.

### D. Create your admin user
1. Go to **Authentication** → **Users** → **Add user** → **Create new user**.
2. Enter your email and a strong password. Tick **Auto Confirm User** if it's offered. Create.
3. Tap the new user and **copy its User UID** (a long id like `1b2c3d4e-...`).

### E. Make that user an admin
1. Go back to **SQL Editor** → **New query**, paste this (put your real id between the quotes):
   ```sql
   insert into public.admins (user_id) values ('PASTE-YOUR-USER-UID-HERE');
   ```
2. Tap **Run**.

### F. Connect the app
1. In Supabase, go to **Project Settings** → **API** (or **Data API / API Keys**).
2. Copy the **Project URL** and the **anon public** key.
   - ⚠️ **Never** use the `service_role` key. It must never go in the app or on GitHub.
3. In GitHub, open `config.js` → tap the ✏️ pencil (Edit) and fill in:
   ```js
   export const SUPABASE_URL = 'https://YOUR-PROJECT.supabase.co';
   export const SUPABASE_ANON_KEY = 'your-anon-public-key';
   ```
4. Tap **Commit changes**.

The anon key is meant to be public — the rules in `schema.sql` make sure anyone can **read** but only users in the `admins` table can **change** anything.

### G. Use it
Open the app → **Admin** (link at the bottom of Home) → sign in with the email and password from step D.

**About adding messages with a direct audio link:** only add audio you have **permission from the owner** to stream. The app shows those entries as "requires permission from the owner", and the database won't save a link unless the permission box is ticked.
