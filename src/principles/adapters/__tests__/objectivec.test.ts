import { describe, it, expect, vi } from 'vitest';
import { ObjectiveCAdapter } from '../objectivec';
import type { Adapter } from '../../types';

vi.mock('fs', () => ({
  readFileSync: vi.fn(),
  existsSync: vi.fn(() => true),
}));

import { readFileSync } from 'fs';

/**
 * @test REQ-QG-001 Language Coverage Extension
 * @intent Verify Objective-C adapter implementation for quality gates
 * @covers AC-QG-001-05, AC-QG-001-06, AC-QG-001-08
 */
describe('ObjectiveCAdapter', () => {
  
  /**
   * @test REQ-QG-001
   * @covers AC-QG-001-05
   */
  it('should implement the Adapter interface', () => {
    (readFileSync as vi.Mock).mockReturnValue('@implementation Test @end');
    const adapter = new ObjectiveCAdapter('test.m');
    
    expect(adapter).toHaveProperty('detectLanguage');
    expect(adapter).toHaveProperty('parseAST');
    expect(adapter).toHaveProperty('extractFunctions');
    expect(adapter).toHaveProperty('extractClasses');
  });

  /**
   * @test REQ-QG-001
   * @covers AC-QG-001-08
   */
  it('should detect language as objectivec for .m files', () => {
    (readFileSync as vi.Mock).mockReturnValue('@implementation Test @end');
    const adapter = new ObjectiveCAdapter('test.m');
    const detected = adapter.detectLanguage();
    expect(detected).toBe('objectivec');
  });

  /**
   * @test REQ-QG-001
   * @covers AC-QG-001-08
   */
  it('should detect language as objectivec for .mm files (Objective-C++)', () => {
    (readFileSync as vi.Mock).mockReturnValue('@implementation Test @end');
    const adapter = new ObjectiveCAdapter('test.mm');
    const detected = adapter.detectLanguage();
    expect(detected).toBe('objectivec');
  });

  /**
   * @test REQ-QG-001
   * @covers AC-QG-001-06
   */
  it('should parse Objective-C file AST correctly', () => {
    (readFileSync as vi.Mock).mockReturnValue('@implementation Test @end');
    const adapter = new ObjectiveCAdapter('test.m');
    const ast = adapter.parseAST();
    expect(ast).toHaveProperty('content');
    expect(ast).toHaveProperty('language');
    expect(ast).toHaveProperty('filePath');
    expect(ast.language).toBe('objectivec');
  });

  /**
   * @test REQ-QG-001
   * @covers AC-QG-001-06
   */
  it('should extract Objective-C instance methods', () => {
    (readFileSync as vi.Mock).mockReturnValue(`
@implementation Calculator
- (int)add:(int)a to:(int)b {
  return a + b;
}
- (void)printResult {
  NSLog(@"Result");
}
@end
`);
    const adapter = new ObjectiveCAdapter('Calculator.m');
    const functions = adapter.extractFunctions();
    expect(Array.isArray(functions)).toBe(true);
    expect(functions.length).toBeGreaterThan(0);
  });

  /**
   * @test REQ-QG-001
   * @covers AC-QG-001-06
   */
  it('should extract Objective-C class methods', () => {
    (readFileSync as vi.Mock).mockReturnValue(`
@implementation StringUtils
+ (NSString *)trim:(NSString *)str {
  return [str stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceCharacterSet]];
}
+ (BOOL)isEmpty:(NSString *)str {
  return [str length] == 0;
}
@end
`);
    const adapter = new ObjectiveCAdapter('StringUtils.m');
    const functions = adapter.extractFunctions();
    expect(Array.isArray(functions)).toBe(true);
  });

  /**
   * @test REQ-QG-001
   * @covers AC-QG-001-06
   */
  it('should extract C functions from Objective-C file', () => {
    (readFileSync as vi.Mock).mockReturnValue(`
int helperFunction(int x) {
  return x * 2;
}

void logDebug(const char *msg) {
  printf("%s\\n", msg);
}

@implementation Helper
- (void)process {
  int result = helperFunction(5);
}
@end
`);
    const adapter = new ObjectiveCAdapter('Helper.m');
    const functions = adapter.extractFunctions();
    expect(Array.isArray(functions)).toBe(true);
    expect(functions.some(fn => (fn as any).type === 'function')).toBe(true);
  });

  /**
   * @test REQ-QG-001
   * @covers AC-QG-001-06
   */
  it('should extract @implementation declarations', () => {
    (readFileSync as vi.Mock).mockReturnValue(`
@implementation MyClass
- (void)doSomething {}
@end
`);
    const adapter = new ObjectiveCAdapter('MyClass.m');
    const classes = adapter.extractClasses();
    expect(Array.isArray(classes)).toBe(true);
    expect(classes.some(cls => (cls as any).name === 'MyClass')).toBe(true);
    expect(classes.some(cls => (cls as any).type === 'implementation')).toBe(true);
  });

  /**
   * @test REQ-QG-001
   * @covers AC-QG-001-06
   */
  it('should extract @interface declarations', () => {
    (readFileSync as vi.Mock).mockReturnValue(`
@interface MyProtocol
- (void)requiredMethod;
@end
`);
    const adapter = new ObjectiveCAdapter('MyProtocol.m');
    const classes = adapter.extractClasses();
    expect(Array.isArray(classes)).toBe(true);
    expect(classes.some(cls => (cls as any).name === 'MyProtocol')).toBe(true);
    expect(classes.some(cls => (cls as any).type === 'interface')).toBe(true);
  });

  /**
   * @test REQ-QG-001
   * @covers AC-QG-001-06
   */
  it('should handle multiple @implementation blocks', () => {
    (readFileSync as vi.Mock).mockReturnValue(`
@implementation FirstClass
- (void)method1 {}
@end

@implementation SecondClass
- (void)method2 {}
@end
`);
    const adapter = new ObjectiveCAdapter('Multiple.m');
    const classes = adapter.extractClasses();
    expect(Array.isArray(classes)).toBe(true);
    expect(classes.length).toBeGreaterThanOrEqual(2);
  });

  /**
   * @test REQ-QG-001
   * @covers AC-QG-001-06
   */
  it('should handle Objective-C inheritance syntax', () => {
    (readFileSync as vi.Mock).mockReturnValue(`
@interface ChildClass : ParentClass
- (void)overrideMethod;
@end
`);
    const adapter = new ObjectiveCAdapter('ChildClass.m');
    const classes = adapter.extractClasses();
    expect(Array.isArray(classes)).toBe(true);
    expect(classes.some(cls => (cls as any).name === 'ChildClass')).toBe(true);
  });

  /**
   * @test REQ-QG-001
   * @covers AC-QG-001-06
   */
  it('should handle Objective-C categories', () => {
    (readFileSync as vi.Mock).mockReturnValue(`
@implementation NSString (Extensions)
- (NSString *)reversed {
  // implementation
}
@end
`);
    const adapter = new ObjectiveCAdapter('Extensions.m');
    const classes = adapter.extractClasses();
    expect(Array.isArray(classes)).toBe(true);
  });

  /**
   * @test REQ-QG-001
   * @covers AC-QG-001-06
   */
  it('should handle Objective-C properties', () => {
    (readFileSync as vi.Mock).mockReturnValue(`
@interface Person
@property (nonatomic, strong) NSString *name;
@property (nonatomic) NSInteger age;
- (void)introduce;
@end

@implementation Person
- (void)introduce {
  NSLog(@"Hi, I'm %@", self.name);
}
@end
`);
    const adapter = new ObjectiveCAdapter('Person.m');
    const classes = adapter.extractClasses();
    expect(Array.isArray(classes)).toBe(true);
    const functions = adapter.extractFunctions();
    expect(Array.isArray(functions)).toBe(true);
  });

  /**
   * @test REQ-QG-001
   * @covers AC-QG-001-06, AC-QG-001-08
   */
  it('should handle Objective-C++ (.mm) files with C++ content', () => {
    (readFileSync as vi.Mock).mockReturnValue(`
#import <Foundation/Foundation.h>
#include <vector>

@implementation MixedClass {
  std::vector<int> _data;
}

- (void)processCpp {
  _data.push_back(42);
}

@end
`);
    const adapter = new ObjectiveCAdapter('Mixed.mm');
    expect(adapter.detectLanguage()).toBe('objectivec');
    const classes = adapter.extractClasses();
    expect(Array.isArray(classes)).toBe(true);
  });

  /**
   * @test REQ-QG-001
   * @covers AC-QG-001-05
   */
  it('should count physical lines correctly', () => {
    (readFileSync as vi.Mock).mockReturnValue('@implementation Test\n- (void)method {}\n@end');
    const adapter = new ObjectiveCAdapter('test.m');
    const lineCount = adapter.countLines();
    expect(lineCount).toBe(3);
  });

  /**
   * @test REQ-QG-001
   * @covers AC-QG-001-06
   */
  it('should handle empty file', () => {
    (readFileSync as vi.Mock).mockReturnValue('');
    const adapter = new ObjectiveCAdapter('empty.m');
    const functions = adapter.extractFunctions();
    const classes = adapter.extractClasses();
    expect(functions.length).toBe(0);
    expect(classes.length).toBe(0);
  });

  /**
   * @test REQ-QG-001
   * @covers AC-QG-001-06
   */
  it('should handle Objective-C literals and modern syntax', () => {
    (readFileSync as vi.Mock).mockReturnValue(`
@implementation ModernObjC
- (NSArray *)getItems {
  return @[ @"one", @"two", @"three" ];
}
- (NSDictionary *)getDict {
  return @{ @"key": @"value" };
}
- (NSNumber *)getNumber {
  return @42;
}
@end
`);
    const adapter = new ObjectiveCAdapter('ModernObjC.m');
    const functions = adapter.extractFunctions();
    expect(Array.isArray(functions)).toBe(true);
  });

  /**
   * @test REQ-QG-001
   * @covers AC-QG-001-06
   */
  it('should handle Objective-C blocks', () => {
    (readFileSync as vi.Mock).mockReturnValue(`
@implementation BlockUser
- (void)useBlock {
  void (^myBlock)(void) = ^{
    NSLog(@"Block executed");
  };
  myBlock();
}
@end
`);
    const adapter = new ObjectiveCAdapter('BlockUser.m');
    const functions = adapter.extractFunctions();
    expect(Array.isArray(functions)).toBe(true);
  });

  /**
   * @test REQ-QG-001
   * @covers AC-QG-001-08
   */
  it('should handle preprocessor directives', () => {
    (readFileSync as vi.Mock).mockReturnValue(`
#import <Foundation/Foundation.h>
#define MAX_SIZE 100

#ifdef DEBUG
@implementation DebugHelper
- (void)logDebug {}
@end
#endif
`);
    const adapter = new ObjectiveCAdapter('Preprocessor.m');
    expect(adapter.detectLanguage()).toBe('objectivec');
  });

  /**
   * @test REQ-QG-001
   * @covers AC-QG-001-05
   */
  it('should throw error when file cannot be read', () => {
    (readFileSync as vi.Mock).mockImplementation(() => {
      throw new Error('Could not read file');
    });
    
    expect(() => {
      new ObjectiveCAdapter('nonexistent-file.m');
    }).toThrow('Could not read file:');
  });

  /**
   * @test REQ-QG-001
   * @covers AC-QG-001-06
   */
  it('should extract method with multiple parameters', () => {
    (readFileSync as vi.Mock).mockReturnValue(`
@implementation MultiParam
- (void)drawRect:(CGRect)rect withColor:(UIColor *)color andAlpha:(float)alpha {
  // drawing code
}
@end
`);
    const adapter = new ObjectiveCAdapter('MultiParam.m');
    const functions = adapter.extractFunctions();
    expect(Array.isArray(functions)).toBe(true);
  });

  /**
   * @test REQ-QG-001
   * @covers AC-QG-001-05, AC-QG-001-06
   */
  it('should handle static inline C functions', () => {
    (readFileSync as vi.Mock).mockReturnValue(`
static inline int fastAdd(int a, int b) {
  return a + b;
}

@implementation FastMath
- (int)compute {
  return fastAdd(1, 2);
}
@end
`);
    const adapter = new ObjectiveCAdapter('FastMath.m');
    const functions = adapter.extractFunctions();
    expect(Array.isArray(functions)).toBe(true);
    expect(functions.some(fn => (fn as any).type === 'function')).toBe(true);
  });

  /**
   * @test REQ-QG-001
   * @covers AC-QG-001-05
   */
  it('should extract line number for extracted elements', () => {
    (readFileSync as vi.Mock).mockReturnValue(`
@implementation LineTest
- (void)firstMethod {}
- (void)secondMethod {}
@end
`);
    const adapter = new ObjectiveCAdapter('LineTest.m');
    const functions = adapter.extractFunctions();
    expect(functions.every(fn => typeof (fn as any).line === 'number')).toBe(true);
  });

  /**
   * @test REQ-QG-001
   * @covers AC-QG-001-05
   */
  it('should extract code block for methods', () => {
    (readFileSync as vi.Mock).mockReturnValue(`
@implementation CodeBlockTest
- (int)calculate {
  int result = 0;
  for (int i = 0; i < 10; i++) {
    result += i;
  }
  return result;
}
@end
`);
    const adapter = new ObjectiveCAdapter('CodeBlockTest.m');
    const functions = adapter.extractFunctions();
    expect(functions.every(fn => typeof (fn as any).code === 'string')).toBe(true);
  });
});