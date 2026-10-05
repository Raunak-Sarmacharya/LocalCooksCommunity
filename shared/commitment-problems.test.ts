import { describe, expect, it } from 'vitest';
import { problemDestination, problemTransition } from './commitment-problems';
describe('Local Cooks problem ownership and resolution', () => {
  it('requires explicit staff claim and preserves acknowledged as outstanding', () => {
    expect(() => problemTransition('reported','acknowledge',null,1,'Received')).toThrow('Claim');
    expect(() => problemTransition('reported','resolve',1,1,'Finished')).toThrow('Acknowledge');
    expect(problemTransition('reported','acknowledge',1,1,'Received')).toBe('acknowledged');
    expect(problemTransition('acknowledged','escalate',1,1,'Operational assistance needed')).toBe('escalated');
    expect(problemTransition('escalated','resolve',1,1,'Participant confirms recovery')).toBe('resolved');
  });
  it('rejects a different staff owner, blank responses and post-resolution changes', () => {
    expect(() => problemTransition('acknowledged','resolve',1,2,'Finished')).toThrow('Claim');
    expect(() => problemTransition('reported','acknowledge',1,1,'  ')).toThrow('response');
    expect(() => problemTransition('resolved','escalate',1,1,'Retry')).toThrow('resolved');
  });
  it('allows an explicitly reasoned Local Cooks takeover while retaining current status', () => {
    expect(problemTransition('acknowledged','reassign',1,2,'Taking over the operational recovery')).toBe('acknowledged');
    expect(() => problemTransition('acknowledged','reassign',1,2,'')).toThrow('Claim');
  });
  it('uses actual booking, tour and Local Cooks destinations', () => {
    expect(problemDestination('booking',10,'chef')).toBe('/booking/10');
    expect(problemDestination('booking',10,'manager')).toBe('/manager/booking/10');
    expect(problemDestination('tour',20,'chef')).toContain('viewing=20');
    expect(problemDestination('tour',20,'manager')).toBe('/manager/dashboard?view=viewings&viewing=20');
    expect(problemDestination('tour',20,'admin')).toBe('/admin?section=live-problems');
  });
});
