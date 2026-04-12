import { FunctionInfo, ClassInfo, FieldInfo, ParameterInfo, LanguageAdapter } from '../types.js';

/**
 * Language adapter for TypeScript and JavaScript files.
 * 
 * Uses AST parsing to extract code constructs like functions, classes,
 * parameters, and complexity metrics.
 */
export const getFileExtensions = (): string[] => ['.ts', '.tsx', '.js', '.jsx'];

export const parseAST = async (sourceCode: string): Promise<any> => {
  // For this initial implementation, we'll return a simple representation
  // In practice, we would integrate with a real parser like swc, TypeScript compiler API, or babel
  const { parse } = await import('@babel/parser');
  return parse(sourceCode, {
    sourceType: 'module',
    plugins: [
      'typescript',
      'jsx',
      'decorators-legacy',
      'classProperties',
      'asyncGenerators',
      'functionBind',
      'exportDefaultFrom',
      'exportNamespaceFrom',
      'dynamicImport'
    ]
  });
};

export const extractFunctions = (ast: any): FunctionInfo[] => {
  const functions: FunctionInfo[] = [];

  const traverseNode = (node: any, parent: any = null) => {
    if (!node) return;

    // Handle various function types
    if (
      node.type === 'FunctionDeclaration' ||
      node.type === 'FunctionExpression' ||
      node.type === 'ArrowFunctionExpression' ||
      node.type === 'MethodDefinition'
    ) {
      const startLine = node.loc ? node.loc.start.line : 1;
      const endLine = node.loc ? node.loc.end.line : 1;
      
      const funcInfo: FunctionInfo = {
        name: getFunctionName(node),
        startLine,
        endLine,
        parameters: extractParameters(node),
        nestingDepth: calculateNestingDepth(node),
        complexity: calculateCyclomaticComplexity(node),
        linesOfCode: extractLinesOfCodeFromFunction(node),
        sourceCode: getNodeSource(node, ast)
      };
      
      functions.push(funcInfo);
    }

    // Recursively process child nodes
    Object.keys(node).forEach(key => {
      const child = node[key];
      if (child && typeof child === 'object') {
        if (Array.isArray(child)) {
          child.forEach(item => traverseNode(item, node));
        } else {
          traverseNode(child, node);
        }
      }
    });
  };

  traverseNode(ast);
  return functions;
};

export const extractClasses = (ast: any): ClassInfo[] => {
  const classes: ClassInfo[] = [];

  const traverser = (node: any) => {
    if (node.type === 'ClassDeclaration' || node.type === 'ClassExpression') {
      const classInfo: ClassInfo = {
        name: node.id?.name || '<anonymous>',
        methods: [],
        fields: [],
        startLine: node.loc?.start.line || 1,
        endLine: node.loc?.end.line || 1,
        sourceCode: getNodeSource(node, ast)
      };

      if (node.superClass?.name) {
        classInfo.superClass = node.superClass.name;
      }

      // Extract methods and fields from class body
      if (node.body?.body) {
        for (const member of node.body.body) {
          if (member.type === 'MethodDefinition') {
            const methodStart = member.loc?.start.line || 1;
            const methodEnd = member.loc?.end.line || 1;
            
            const methodInfo: FunctionInfo = {
              name: member.key?.name || '<anonymous>',
              startLine: methodStart,
              endLine: methodEnd,
              parameters: extractParameters(member),
              nestingDepth: calculateNestingDepth(member),
              complexity: calculateCyclomaticComplexity(member),
              linesOfCode: extractLinesOfCodeFromMember(member),
              sourceCode: getNodeSource(member, ast)
            };
            
            classInfo.methods.push(methodInfo);
          } else if (member.type === 'Property') {
            const field: FieldInfo = {
              name: member.key?.name || '<anonymous>',
              type: member.typeAnnotation?.typeAnnotation?.typeName?.name,
              visibility: getVisibilityFromModifier(member),
              startLine: member.loc?.start.line || 1,
              endLine: member.loc?.end.line || 1
            };
            classInfo.fields.push(field);
          }
        }
      }

      classes.push(classInfo);
    }

    // Traverse children
    Object.keys(node).forEach(key => {
      const child = node[key];
      if (child && typeof child === 'object') {
        if (Array.isArray(child)) {
          child.forEach(ch => traverser(ch));
        } else {
          traverser(child);
        }
      }
    });
  };

  traverser(ast);
  return classes;
};

export const countLinesOfCode = (sourceCode: string): number => {
  // Count non-empty, non-comment lines
  const lines = sourceCode.split('\n');
  let loc = 0;

  for (const line of lines) {
    const trimmedLine = line.trim();
    if (
      trimmedLine &&
      !trimmedLine.startsWith('//') &&
      !trimmedLine.startsWith('/*') &&
      !trimmedLine.startsWith('*')
    ) {
      loc++;
    }
  }

  return loc;
};

export const isComment = (
  sourceCode: string,
  startLine: number,
  startColumn: number,
  endLine: number,
  endColumn: number
): boolean => {
  const lines = sourceCode.split('\n');
  let inMultilineComment = false;

  for (let i = startLine - 1; i < endLine; i++) {
    const line = lines[i] || '';
    
    if (line.includes('/*')) {
      inMultilineComment = true;
    }
    
    if (inMultilineComment) {
      if (line.includes('*/')) {
        inMultilineComment = false;
      }
      return true;
    }
    
    if (line.trim().startsWith('//')) {
      return true;
    }
  }
  
  return inMultilineComment;
};

export const getFunctionSignature = (funcInfo: FunctionInfo): string => {
  const params = funcInfo.parameters.map(p => p.name).join(', ');
  return `${funcInfo.name}(${params})`;
};

// Helper functions
const getFunctionName = (node: any): string => {
  if (node.id?.name) {
    return node.id.name;
  } else if (node.key?.name) {
    return node.key.name;
  } else if (node.type === 'MethodDefinition') {
    return node.key?.name || '<anonymous>';
  } else if (node.type === 'ArrowFunctionExpression') {
    // For arrow functions, find closest identifier in scope
    return '<anonymous-arrow>';
  }
  return '<anonymous>';
};

const extractParameters = (node: any): ParameterInfo[] => {
  let params: ParameterInfo[] = [];
  
  if (node.params) {
    params = node.params.map((param: any) => ({
      name: param.name || getNameFromPattern(param) || '<anonymous>',
      type: param.typeAnnotation?.typeAnnotation?.typeName?.name,
      optional: param.optional || false
    }));
  }

  return params;
};

const getNameFromPattern = (param: any): string | null => {
  if (param.type === 'ObjectPattern') {
    return '{...}';
  } else if (param.type === 'ArrayPattern') {
    return '[...]';
  } else if (param.type === 'AssignmentPattern') {
    return param.left?.name || getNameFromPattern(param.left);
  }
  return null;
};

const calculateNestingDepth = (node: any): number => {
  // For simplicity, calculate based on depth of certain AST node types
  let depth = 0;
  
  const traverse = (current: any, currentDepth: number) => {
    if (!current || typeof current !== 'object') return;
    
    let newDepth = currentDepth;
    if (isBlockNode(current)) {
      newDepth++;
      depth = Math.max(depth, newDepth);
    }
    
    Object.values(current).forEach(child => {
      if (child && typeof child === 'object') {
        if (Array.isArray(child)) {
          child.forEach(item => traverse(item, newDepth));
        } else {
          traverse(child, newDepth);
        }
      }
    });
  };
  
  traverse(node, 0);
  return depth;
};

const isBlockNode = (node: any): boolean => {
  return ['BlockStatement', 'IfStatement', 'ForStatement', 
          'WhileStatement', 'TryStatement', 'CatchClause',
          'SwitchStatement'].includes(node.type);
};

const calculateCyclomaticComplexity = (node: any): number => {
  let complexity = 1; // Start at 1 (for the function itself)
  
  const traverse = (current: any) => {
    if (!current || typeof current !== 'object') return;
    
    // Increment for control flow statements
    if ([
      'IfStatement', 'SwitchStatement', 
      'ForStatement', 'ForInStatement', 'ForOfStatement',
      'WhileStatement', 'DoWhileStatement',
      'ConditionalExpression', 
      'LogicalExpression' // For && and || operators
    ].includes(current.type)) {
      complexity++;
    }
    
    Object.values(current).forEach(child => {
      if (child && typeof child === 'object') {
        if (Array.isArray(child)) {
          child.forEach(traverse);
        } else {
          traverse(child);
        }
      }
    });
  };
  
  traverse(node);
  return complexity;
};

const extractLinesOfCodeFromFunction = (node: any): number => {
  // Calculate LoC for the function based on source
  if (!node.loc) return 0;
  
  // For this simple implementation, just return the number of lines
  // between start and end, minus comments inside
  return Math.max(1, node.loc.end.line - node.loc.start.line + 1);
};

const extractLinesOfCodeFromMember = (node: any): number => {
  if (!node.loc) return 0;
  return Math.max(1, node.loc.end.line - node.loc.start.line + 1);
};

const getVisibilityFromModifier = (node: any): 'public' | 'private' | 'protected' => {
  if (node.accessibility === 'private') return 'private';
  if (node.accessibility === 'protected') return 'protected';
  return 'public'; // default
};

const getNodeSource = (node: any, ast: any): string => {
  // For simplicity, we will return empty string for now
  // In a real implementation, we would extract the original source code for the node
  return "";
};