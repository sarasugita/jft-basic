# Dev Notes

## Admin App Cache Recovery

If the admin app shows webpack cache warnings like `incorrect header check`, the local Next.js cache is corrupted.

From the repo root:

```bash
npm run clean:admin-cache
```

If you want to clear the full admin build output instead of just the cache:

```bash
npm run clean:admin-next
```

To clear the admin cache and rebuild in one step:

```bash
npm run rebuild:admin
```

## Cleanly Stopping The Admin Dev Server

If `next dev` is running in the foreground, stop it with:

```bash
Ctrl+C
```

Wait for the shell prompt to return before closing the terminal or switching workflows.

If the process is stuck, stop it with a normal signal first:

```bash
ps aux | grep "next dev"
kill <pid>
```

Use a force kill only if the normal `kill` does not work:

```bash
kill -9 <pid>
```

## Recommended Workflow

- Run only one admin `next dev` process at a time.
- Stop the dev server cleanly before switching branches or pulling large dependency changes.
- Run `npm run clean:admin-cache` after Next.js, React, or lockfile changes.
- If the admin app gets stuck in a bad build state, run `npm run rebuild:admin`.
