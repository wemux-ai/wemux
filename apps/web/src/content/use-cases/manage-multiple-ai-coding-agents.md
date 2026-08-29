# Where multi-agent coding breaks down

The problem is usually not access to more agents. The problem is keeping agent work routed, visible, and reviewable once more than one agent is active.

- One agent finds context in chat, another edits locally, and nobody can see the full delivery path.
- Different tasks need different repos, runtimes, machines, and access scopes.
- A team gets more raw output, but less confidence about what actually ran and what should be reviewed.

## What a controlled orchestration layer should do

### Shared task surface

Keep AI coding work in a visible queue instead of scattered across personal assistant tabs.

### Worker-aware routing

Route each task to the worker that already has the correct repository, environment, or machine access.

### Reviewable output

Make every run return logs, branches, and artifacts a human can inspect before anything moves forward.

## A practical framing

Use multiple agents when they increase throughput or specialization. Do not hide the delivery contract behind them.

Each task still needs a real repo target, a real execution surface, logs, branch output, and a human checkpoint.

That is the difference between multi-agent novelty and multi-agent delivery.

## Good fit signals

- You are already experimenting with more than one coding agent or more than one runtime.
- Your team needs AI work to come back as reviewable repository changes, not just message output.
- You want coordination rules without pretending the whole workflow should become fully autonomous.

