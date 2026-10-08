# Updates from Claude (inbox)

`inbox.json` is read by the deployed site (raw.githubusercontent.com, cached ~5 minutes) and offered to the
matching project in **Updates from Claude**. Nothing is applied without the student's click, and every apply can
be undone. This folder is public: put only report content here (figures, logos), never personal data.

```json
{ "version": 1, "items": [ {
  "id": "unique-id (bump the suffix to send a new version)", "project": "Meyar" | "*",
  "kind": "projectLogo" | "figure", "createdAt": "ISO date-time",
  "title": "…", "titleAr": "…", "description": "…", "descriptionAr": "…",
  "asset": "assets/file.png",                                   // projectLogo
  "figure": { "id": "stable id", "title": "…", "type": "generic" | "gantt" | …,
              "diagram": { … } | "gantt": { "tasks": [ … ], … } },     // figure
  "place": { "sectionTitles": ["…"], "chapterTitles": ["…"] }   // optional
} ] }
```

A figure whose `id` already exists in the project is updated in place (its location is kept).
