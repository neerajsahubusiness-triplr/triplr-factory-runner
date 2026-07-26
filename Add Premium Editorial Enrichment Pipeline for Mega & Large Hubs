## Premium Editorial Enrichment Pipeline

Introduced a completely separate editorial enrichment pipeline for Mega and Large hubs without modifying the existing Factory generation workflow.

### New functionality

- Added dedicated Premium Editorial Enrichment endpoint:
  - POST /factory/enrich-premium-editorial

- Processes one approved cluster at a time using GPT-5.5.

- Reads approved activities from:
  - hub_activities

- Writes enhanced editorial content only to:
  - hub_activity_enhancements

### Premium editorial generation

Generates the following fields for every approved activity:

- description
- why_special
- why_it_matters
- why_this_stop_works
- pro_tip
- photo_tip
- avoid
- editorial_priority

Editorial priorities are re-ranked independently within each cluster from 1..N based on comparative traveller value and itinerary importance.

### Validation

Added strict response validation before saving:

- all approved activity_ids must be returned
- no missing or duplicate activities
- no unknown activity_ids
- all editorial fields required
- minimum content quality checks
- unique sequential priorities (1..N)
- markdown removed
- cluster integrity validation

### Safety

This pipeline is fully isolated from the existing Factory workflow.

No changes were made to:

- Hub generation
- Cluster generation
- Google enrichment
- Geo enrichment
- Image enrichment
- Pexels enrichment
- Hub finalisation
- Production hub_activities

All generated editorial content is staged in hub_activity_enhancements for QA before publication.

### Purpose

Provides a premium editorial layer for approximately 200 Mega and Large destinations, significantly improving itinerary intelligence, destination storytelling and traveller guidance while preserving the existing Factory pipeline.
