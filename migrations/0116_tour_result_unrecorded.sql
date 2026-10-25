-- A confirmed tour nobody recorded closes itself 24 h after its end (closeUnrecordedTour) and logs its result as
-- 'unrecorded'. The result check from 0067 only allowed completed/visitor_absent/disrupted, so the automatic close
-- failed every time and such tours stayed "confirmed" forever. Allow the value the code and the history already use.
ALTER TABLE tour_visit_events DROP CONSTRAINT IF EXISTS tour_visit_events_result_check;
ALTER TABLE tour_visit_events ADD CONSTRAINT tour_visit_events_result_check
  CHECK (result IS NULL OR result IN ('completed','visitor_absent','disrupted','unrecorded'));
