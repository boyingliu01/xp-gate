describe('install-cmd', () => {
  it('exports install function', () => {
    const { install } = require('../install-cmd');
    expect(typeof install).toBe('function');
  });
});
