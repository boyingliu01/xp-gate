import { describe, it, expect } from 'vitest';
import { dipRule } from '../../solid/dip';

const mockAdapter = {
  detectLanguage: () => 'typescript',
  parseAST: () => {},
  extractFunctions: () => [],
  extractClasses: () => [],
  countLines: () => 0
};

describe('dip.ts - Dependency Inversion Principle Rule', () => {
  it('should detect direct instantiation in business logic', () => {
    const mockAdapterWithDirectInstantiation = {
      ...mockAdapter,
      extractClasses: () => [{
        name: 'UserService',
        line: 1,
        code: `
class UserService {
  private repo = new UserRepository();
  
  getUser(id: string) {
    return this.repo.findById(id);
  }
}
`
      }]
    };
    
    const violations = dipRule.check('test.ts', mockAdapterWithDirectInstantiation as any);
    
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0].ruleId).toBe('solid.dip');
  });

  it('should pass for dependency injection pattern', () => {
    const mockAdapterWithDI = {
      ...mockAdapter,
      extractClasses: () => [{
        name: 'UserService',
        line: 1,
        code: `
class UserService {
  constructor(private repo: IRepository) {}
  
  getUser(id: string) {
    return this.repo.findById(id);
  }
}
`
      }]
    };
    
    const violations = dipRule.check('test.ts', mockAdapterWithDI as any);
    
    expect(violations.length).toBe(0);
  });

  it('should exclude value objects (Date, Map, Set, etc)', () => {
    const mockAdapterWithValueObjects = {
      ...mockAdapter,
      extractClasses: () => [{
        name: 'DateService',
        line: 1,
        code: `
class DateService {
  formatDate(date: Date) {
    return new Intl.DateTimeFormat().format(date);
  }
}
`
      }]
    };
    
    const violations = dipRule.check('test.ts', mockAdapterWithValueObjects as any);
    
    expect(violations.length).toBe(0);
  });

  it('should use threshold from config', () => {
    expect(dipRule.severity).toBe('warning');
  });

  it('should return empty violations when adapter throws error', () => {
    const mockAdapterThatThrows = {
      ...mockAdapter,
      extractClasses: () => { throw new Error('Adapter failed'); }
    };
    
    const violations = dipRule.check('test.ts', mockAdapterThatThrows as any);
    
    expect(violations.length).toBe(0);
  });

  it('should exclude built-in types (Date, Map, Set, etc.)', () => {
    const mockAdapterWithBuiltins = {
      ...mockAdapter,
      extractClasses: () => [{
        name: 'Service',
        line: 1,
        code: `class Service { run() { return new Date(); } }`
      }]
    };
    const violations = dipRule.check('test.ts', mockAdapterWithBuiltins as any);
    expect(violations.length).toBe(0);
  });

  it('should exclude Factory and Builder patterns', () => {
    const mockAdapterWithFactory = {
      ...mockAdapter,
      extractClasses: () => [{
        name: 'Client',
        line: 1,
        code: `class Client { create() { return new UserFactory(); } }`
      }]
    };
    const violations = dipRule.check('test.ts', mockAdapterWithFactory as any);
    expect(violations.length).toBe(0);
  });
});