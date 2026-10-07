import { render } from '@testing-library/react';
import { expect,it,vi } from 'vitest';
import { TourAttendancePanel } from './TourAttendancePanel';
it.each(['chef','manager','admin'] as const)('retires manual tour attendance controls for %s without any requests',role=>{
 const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);
 const{container,unmount}=render(<TourAttendancePanel id={42} role={role} version="version" />);
 expect(container).toBeEmptyDOMElement();expect(fetcher).not.toHaveBeenCalled();unmount();vi.unstubAllGlobals();
});
