import { CharCodes } from './types'
import Parser from './parser'
import { isValidFunctionLiteralChar } from './utils'

export class Expression {
  constructor(
    public start: number = 0,
    public end: number = 0,
    public expression: string = '',
  ) {}
}

export class CallExpression extends Expression {
  constructor(
    start: number = 0,
    end: number = 0,
    expression: string = '',
    public functionNameStart: number = 0,
    public functionNameEnd: number = 0,
    public parameters: string = '',
    public childFunctionExpressions: CallExpression[] = [],
  ) {
    super(start, end, expression)
  }
}

/**
 * ExpressionParser helps parsing expressions inside wxml interpolation block
 */
export default class ExpressionParser extends Parser {
  private blockStart: number = -1
  private expressions: Expression[] = []
  private callExpressions: CallExpression[] = []

  constructor(
    public source: string,
    public fileName: string = ''
  ) {
    super(source, fileName)
  }

  parse() {
    try {
      const expr = this._parse()
      return expr
    } catch (e) {
      if (this.fileName) {
        e.message += `\nfile: ${this.fileName}`
      }
      e.message += `\nline: ${this.line}, column: ${this.column}\n\n${this.currentContext()}`
      throw e
    }
  }

  private _parse() {
    while (!this.eof()) {
      if (this.match(CharCodes.LEFT_CURLY_BRACE) && this.match(CharCodes.LEFT_CURLY_BRACE, this.pos + 1)) {
        this.advance(2)
        this.enterInterpolationBlock()
        // TODO: parse function calls and pass it to transfomers
        this.parseInterpolationExpression()
        continue
      }
      this.advance()
    }
    return { expression: this.expressions, callExpressions: this.callExpressions }
  }

  /**
   * Parse expressions in wxml, it only cares about function calls
   * and ignore other expressions since it's trivial for i18n
   */
  parseInterpolationExpression() {
    while (!this.eof()) {
      this.consumeQuoteString()

      if (this.match(CharCodes.RIGHT_CURLY_BRACE) && this.match(CharCodes.RIGHT_CURLY_BRACE, this.pos + 1)) {
        const { start, end, block } = this.exitInterpolationBlock()
        this.advance(2)
        if (end > start && start !== -1) {
          this.expressions.push(new Expression(start, end, block))
        }
        return
      }

      // maybe function call expression
      if (this.match(CharCodes.LEFT_PAREN)) {
        const start = this.isFunctionCallExpression(this.pos)
        if (start !== -1) {
          const exprs = this.parseFunctionCallExpression(start)
          this.callExpressions.push(exprs)
          continue
        }
      }
      this.advance()
    }
  }

  parseObjectDecl() {
    const callFunctions: CallExpression[] = []
    while (!this.eof()) {
      this.consumeQuoteString()

      if (this.match(CharCodes.RIGHT_CURLY_BRACE)) {
        this.advance()
        return callFunctions
      }
      if (this.match(CharCodes.LEFT_PAREN)) {
        const start = this.isFunctionCallExpression(this.pos)
        if (start !== -1) {
          const expr = this.parseFunctionCallExpression(start)
          callFunctions.push(expr)
        }
      }
      if (this.match(CharCodes.LEFT_CURLY_BRACE)) {
        this.advance()
        callFunctions.push(...this.parseObjectDecl())
        continue
      }
      this.advance()
    }
    return callFunctions
  }

  parseFunctionCallExpression(start: number) {
    const childFunctions: CallExpression[] = []
    const functionNameEnd = this.pos
    if (this.consumeChar() !== CharCodes.LEFT_PAREN) {
      throw new Error('expected a left paren for a function call')
    }
    while (!this.eof()) {
      this.consumeQuoteString()
      if (this.match(CharCodes.LEFT_CURLY_BRACE)) {
        // JavaScript block should be ignored
        this.advance()
        const expr = this.parseObjectDecl()
        childFunctions.push(...expr)
      }
      if (this.consumeChar() === CharCodes.RIGHT_PAREN) {
        break
      }
    }
    return new CallExpression(
      start,
      this.pos,
      this.source.substring(start, functionNameEnd),
      start,
      functionNameEnd,
      this.source.substring(functionNameEnd + 1, this.pos - 1).trim(),
      childFunctions,
    )
  }

  enterInterpolationBlock() {
    // Already in an translation block, this must not be
    // valid translation block
    if (this.blockStart !== -1) return
    this.blockStart = this.pos
  }

  exitInterpolationBlock(): { start: number, end: number, block: string } {
    const start = this.blockStart
    const end = this.pos
    const block = this.source.substring(start, end)
    this.blockStart = -1
    return { start, end, block }
  }

  matchNextChar(code: CharCodes) {
    return this.source.charCodeAt(++this.pos) === code
  }

  isFunctionCallExpression(pos: number) {
    while (--pos >= 0) {
      // maybe wxs call {{ a.b() }}
      if (this.match(CharCodes.DOT, pos)) return -1
      if (!isValidFunctionLiteralChar(this.source.charCodeAt(pos))) break
    }
    return pos + 1
  }
}
