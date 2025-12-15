# Funnel Analytics API

## Overview

Track user journeys through your funnel steps. See how many users reached each step and where they dropped off.

---

## New Endpoint: Get Funnel Stats

```
GET /api/campaigns/:id/funnel-stats
```

**Auth:** JWT required

**Response:**
```json
{
  "campaign_id": 1,
  "campaign_name": "Checkout Flow",
  "total_sessions": 1000,
  "steps": [
    { "key": "view_home", "name": "Landing", "index": 0, "reached": 1000, "percentage": 100 },
    { "key": "view_pricing", "name": "Pricing", "index": 1, "reached": 750, "percentage": 75 },
    { "key": "add_to_cart", "name": "Add to Cart", "index": 2, "reached": 400, "percentage": 40 },
    { "key": "checkout", "name": "Checkout", "index": 3, "reached": 150, "percentage": 15 }
  ]
}
```

**Fields:**
| Field | Type | Description |
|-------|------|-------------|
| `campaign_id` | number | Campaign ID |
| `campaign_name` | string | Campaign name |
| `total_sessions` | number | Total sessions in this campaign |
| `steps` | array | Funnel steps with counts |
| `steps[].key` | string | Step identifier |
| `steps[].name` | string | Display name |
| `steps[].index` | number | Position in funnel (0-indexed) |
| `steps[].reached` | number | Number of sessions that reached this step |
| `steps[].percentage` | number | Percentage of total sessions (0-100) |

---

## Updated Endpoint: Get Session

```
GET /api/sessions/:session_id
```

**New field added: `journey`**

```json
{
  "session_id": "abc-123",
  "status": "dropped_off",
  "furthest_step_index": 2,
  "furthest_step_key": "add_to_cart",
  "journey": ["view_home", "view_pricing", "add_to_cart"]
}
```

| Field | Type | Description |
|-------|------|-------------|
| `journey` | string[] | Ordered list of step keys the user visited |

---

## Usage Examples

### Render a Funnel Chart

```typescript
const response = await fetch(`/api/campaigns/${campaignId}/funnel-stats`, {
  headers: { Authorization: `Bearer ${token}` }
});
const { steps, total_sessions } = await response.json();

// steps is already sorted by index
steps.forEach(step => {
  console.log(`${step.name}: ${step.reached} users (${step.percentage}%)`);
});
```

### Show Session Journey

```typescript
const response = await fetch(`/api/sessions/${sessionId}`, {
  headers: { Authorization: `Bearer ${token}` }
});
const { journey, furthest_step_key } = await response.json();

// journey = ["view_home", "view_pricing", "add_to_cart"]
// furthest_step_key = "add_to_cart"
```

---

## Notes

- `journey` is empty `[]` for sessions recorded before this feature was deployed
- Steps are returned in funnel order (by `index`), not by visit time
- `percentage` is relative to `total_sessions`, not the previous step
