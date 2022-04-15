import { UserGroupGuard } from './user-group-header.guard';

describe('UserGroupHeaderGuard', () => {
  let guard: UserGroupGuard;

  const reflector = jest.mock('@');

  before(() => {
    guard = new UserGroupGuard(reflector);
  });

  it('should be defined', () => {
    expect(new UserGroupGuard(reflector)).toBeDefined();
  });
});
