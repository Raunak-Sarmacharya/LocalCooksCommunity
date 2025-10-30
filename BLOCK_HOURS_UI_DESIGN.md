# 🎨 BLOCK HOURS UI DESIGN

## User Flow

```
Manager clicks date → Modal opens
│
├─ Section 1: Overall Kitchen Status
│   ├─ Toggle: Kitchen Open/Closed
│   └─ If Open: Set default hours (9 AM - 5 PM)
│
├─ Section 2: Blocked Time Ranges (NEW!)
│   ├─ Shows existing blocks:
│   │   • 11:00 AM - 1:00 PM (Lunch break) [Delete]
│   │   • 3:00 PM - 4:00 PM (Cleaning) [Delete]
│   │
│   └─ "+ Block Specific Hours" button
│       ↓ (expands form)
│       ├─ Start Time picker
│       ├─ End Time picker
│       ├─ Reason (optional)
│       └─ [Add Block] button
│
└─ [Save] [Cancel] [Remove All]
```

## Modern Design Principles

1. **Visual Hierarchy**: Clear sections with headers
2. **Intuitive Icons**: Clock icons for time, trash for delete
3. **Color Coding**:
   - Green: Available/default hours
   - Orange: Blocked hours
   - Red: Fully closed
4. **Inline Actions**: Delete buttons right next to blocks
5. **Expandable Form**: "Add" button reveals time picker
6. **Validation**: Prevent overlapping blocks

## Similar to:
- Calendly blocking hours
- Airbnb availability calendar
- Google Calendar blocking

