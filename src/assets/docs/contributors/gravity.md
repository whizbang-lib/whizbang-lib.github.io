---
title: Gravity, the Design Principle Behind Whizbang's APIs
pageType: explanation
audience: [contributor]
status: current
order: 2
description: Whizbang is designed so the path of least resistance is the correct design. The core system owns a behavior through a pipeline or registration API, and a test or analyzer fails when something bypasses it, instead of relying on every author remembering a shared helper.
tags: contributing, architecture, design-principles, api-design, gravity
---

# Gravity, the Design Principle Behind Whizbang's APIs

**Gravity** is the principle every part of Whizbang is designed by: the path of least resistance is the correct design
and architecture. The core system forces you down the right path, so that if you trip and fall, you fall toward the
gravity.

A behavior with gravity is one nobody has to remember. The easiest thing to write is the right thing, and the wrong
thing is either impossible or fails the build.

## Gravity versus a shared helper

When the same correct behavior is needed in many places, there are two ways to share it:

| | A shared helper | Gravity |
|---|---|---|
| Shape | A method each caller invokes | A pipeline, registration or base the system runs |
| Who decides it runs | Every author, every time | The core system, once |
| A new author who does not know about it | Writes it by hand, or forgets it | Gets it anyway |
| When the rule changes | Every call site has to change | One place changes |
| Enforcement | Code review, hope | A test or analyzer that fails when it is bypassed |

A helper is better than copies, but it still depends on the next author choosing it. Gravity removes the choice.

## A worked example: when a worker starts

Every background worker has to wait until startup reaches the right stage before it touches the database. Before
gravity was applied, about 41 places each wrote the same wait by hand: a null check, an await on the schema-ready gate,
and a catch that returns on shutdown. Each copy was a chance to get it subtly wrong, and a new worker had to know to
write it at all.

With gravity, a worker is **registered with the stage it starts at**, and the host starts it only when startup reaches
that stage. The worker contains no gate code. Two checks keep it that way: a test fails when a hosted service is
registered without a stage, and a guard fails when worker code waits on the gate directly to decide when to start. The
easiest way to add a worker is now also the only correct one. (Issue
[#1636](https://github.com/whizbang-lib/whizbang/issues/1636), startup stages.)

## Applying it

When you design or review a Whizbang change, ask:

1. **What does the easiest path produce?** If a contributor or a consumer takes the obvious route, is the result
   correct? If not, the API is wrong, not the contributor.
2. **Who owns the behavior?** Prefer the pipeline, the registration or the generator owning it over each caller
   implementing it.
3. **What fails when someone bypasses it?** Back the design with a test, an analyzer diagnostic, or a type that cannot
   be built the wrong way. Prefer errors to warnings for a new diagnostic.
4. **Is the default safe?** A consumer who configures nothing should get the correct, conservative behavior.

Gravity works alongside the project's other standards: every design choice is documented with its reason and locked by
a test that fails if it flips, and no type ships with tests but no caller.
