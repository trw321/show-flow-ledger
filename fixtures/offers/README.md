# Offer parser fixtures

Every dispatch offer format that has ever parsed wrong goes here, with what it
*should* produce. `npm run eval:parser` scores the live parser against all of
them at once.

The point is that teaching the parser a new format can no longer silently break
a format that already worked — you see the whole board on every change.

## Adding a format that got it wrong

1. Copy the offer text exactly as you received it (tabs and line breaks matter —
   they're part of what makes formats differ).
2. Create `<short-name>.json`:

```json
{
  "name": "text message from steward",
  "input": "Hey can you do Chase Center Thursday 3/19 call 7a, Warriors game, $52.75, ask for Mike",
  "expect": [
    {
      "date": "2026-03-19",
      "startTime": "07:00 AM",
      "venue": "Chase Center",
      "hourlyRate": 52.75,
      "steward": "Mike"
    }
  ]
}
```

Only list the fields you actually care about — anything you omit is ignored, so
a fixture can assert "it must get the date and rate right" without pinning down
every field.

`expect` is an array because one offer can contain several shifts (a callback,
a split shift, a multi-day run).

## Scrub before committing

These files get committed. Replace real names and phone numbers if you'd rather
not have them in the repo — the parser doesn't care whether the steward is
really called Mike.
