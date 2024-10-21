import "reflect-metadata";

type Constructor<T, TArgs extends readonly unknown[]> = new (
  ...input: TArgs
) => T;
type AnyConstructor = Constructor<unknown, unknown[]>;

export function createValidated<T>(
  Class: Constructor<T, unknown[]>,
  data: unknown,
): Result<T, string[]> {
  if (typeof data !== "object" || data === null) {
    throw new TypeError("The passed `data` is not an object.");
  }
  
  // FIXME: `data` is `object`, so the keys are `never` => the props as well

  const validationContext: ClassValidationContext<T> | undefined = Reflect
    .getMetadata(
      CLASS_VALIDATION_METADATA_KEY,
      Class,
    );
  if (!validationContext) {
    throw new TypeError("This class contains no validation.");
  }

  const errors = Object.entries(validationContext).flatMap((tuple) => {
    const [key, meta] = tuple as [
      ValidateablePropertyKey<T>,
      ClassValidationPropertyContext<T[keyof T]>,
    ];

    const propertyAccessor = createPropertyAccessor(
      data,
      key as keyof typeof data,
    );

    for (const parser of meta.parsers) {
      const result = runCatching(() =>
        parser.parse({ value: propertyAccessor.getValue() })
      );

      if ("ok" in result) {
        propertyAccessor.setValue(result.ok as never); // TODO: remove casting?
      } else {
        return [
          `${parser.name}(${key}): ${
            (result.err as Error).message ?? result.err
          }`,
        ];
      }
    }

    if (meta.allowNull && propertyAccessor.getValue() === null) {
      return;
    }

    if (meta.allowUndefined && propertyAccessor.getValue() === undefined) {
      return;
    }

    const maybeNestedClassValidation: AnyClassValidationContext | undefined =
      Reflect
        .getMetadata(
          CLASS_VALIDATION_METADATA_KEY,
          meta.designType,
        );
    if (maybeNestedClassValidation) {
      const nestedClassValidatedResult = createValidated(
        meta.designType,
        propertyAccessor.getValue(),
      );
      if ("err" in nestedClassValidatedResult) {
        return nestedClassValidatedResult.err.map((error) =>
          `validate-nested-class(${key}): ${error}`
        );
      }

      propertyAccessor.setValue(nestedClassValidatedResult.ok as never);
      return;
    }

    return meta.rules.map((rule) => {
      const error = rule.test({ value: propertyAccessor.getValue() });
      if (error) {
        return `${rule.name}(${key}): ${error}`;
      }
    }).filter((x) => !!x);
  }).filter((x) => !!x);

  if (errors.length > 0) {
    return { err: errors as string[] };
  }

  return {
    ok: Object.create(
      Class.prototype,
      Object.fromEntries(
        Object.entries(data).map(([key, value]) => [key, { value }]),
      ),
    ),
  };
}

export function Validate<
  T extends object,
  K extends ValidateablePropertyKey<T>,
>() {
  return (
    prototype: T,
    key: K,
  ) => {
    const Class = prototype.constructor;

    const classContext: ClassValidationContext<T> = Reflect.getMetadata(
      CLASS_VALIDATION_METADATA_KEY,
      Class,
    ) ?? (() => {
      const classContext = {} as ClassValidationContext<T>;
      Reflect.defineMetadata(
        CLASS_VALIDATION_METADATA_KEY,
        classContext,
        Class,
      );
      return classContext;
    })();

    if (!classContext[key]) {
      const designType = Reflect.getMetadata("design:type", prototype, key);
      classContext[key] = {
        allowNull: false,
        allowUndefined: false,
        designType,
        rules: [],
        parsers: [],
      };
    }
  };
}

type RuleOptions<TValue> = {
  test: (
    opts: {
      value: TValue;
      propName: string;
      propertyContext: ClassValidationPropertyContext<TValue>;
    },
  ) => ValidationTestResult;
  name?: string;
};

export function Rule<T extends object, K extends ValidateablePropertyKey<T>>(
  testOrOptions: RuleOptions<T[K]>["test"] | RuleOptions<T[K]>,
  maybeOptions?: RuleOptions<T[K]>,
) {
  const options: RuleOptions<T[K]> = typeof testOrOptions === "function"
    ? { ...maybeOptions, test: testOrOptions }
    : { ...testOrOptions };

  return (
    prototype: T,
    key: K,
  ) => {
    ValidateImperatively<T, K>(({ propertyContext }) => {
      propertyContext.rules.push({
        name: options.name || options.test.name || "custom-rule",
        test: ({ value }) =>
          options.test({ value, propertyContext, propName: key }),
      });
    })(prototype, key);
  };
}

export function IsOptional<
  T extends object,
  K extends ValidateablePropertyKey<T>,
>() {
  return (
    prototype: T,
    key: K,
  ) => {
    ValidateImperatively<T, K>(({ propertyContext }) => {
      propertyContext.allowUndefined = true;
    })(prototype, key);
  };
}

export function IsNullable<
  T extends object,
  K extends ValidateablePropertyKey<T>,
>() {
  return (
    prototype: T,
    key: K,
  ) => {
    ValidateImperatively<T, K>(({ propertyContext }) => {
      propertyContext.allowUndefined = true;
    })(prototype, key);
  };
}

export function ValdidateDesignType<
  T extends object,
  K extends ValidateablePropertyKey<T>,
>() {
  return Rule<T, K>({
    name: "validate-design-type",
    test: ({ value, propertyContext }) => {
      if (
        value === undefined || value === null ||
        (value.constructor !== propertyContext.designType &&
          !(value instanceof propertyContext.designType))
      ) {
        return `Expected \`${propertyContext.designType.name}\`, but got \`${
          JSON.stringify(value)
        }\``;
      }
    },
  });
}

type ParseOptions<TValue> = {
  parse: (
    opts: {
      value: unknown;
      propName: string;
      propertyContext: ClassValidationPropertyContext<TValue>;
    },
  ) => TValue;
  name?: string;
};

export function Parse<T extends object, K extends ValidateablePropertyKey<T>>(
  parseOrOptions: ParseOptions<T[K]>["parse"] | ParseOptions<T[K]>,
  maybeOptions?: ParseOptions<T[K]>,
) {
  const options: ParseOptions<T[K]> = typeof parseOrOptions === "function"
    ? { ...maybeOptions, parse: parseOrOptions }
    : { ...parseOrOptions };

  return (
    prototype: T,
    key: K,
  ) => {
    ValidateImperatively<T, K>(({ propertyContext }) => {
      propertyContext.parsers.push({
        name: options.name || options.parse.name || "custom-rule",
        parse: ({ value }) =>
          options.parse({ value, propertyContext, propName: key }),
      });
    })(prototype, key);
  };
}

export function ValidateImperatively<
  T extends object,
  K extends ValidateablePropertyKey<T>,
>(
  visitContext: (opts: {
    propertyContext: ClassValidationPropertyContext<T[K]>;
    classContext: ClassValidationContext<T>;
  }) => void,
) {
  return (
    prototype: T,
    key: K,
  ) => {
    Validate<T, K>()(prototype, key);

    const Class = prototype.constructor;
    const classContext: ClassValidationContext<T> = Reflect.getMetadata(
      CLASS_VALIDATION_METADATA_KEY,
      Class,
    );

    visitContext({ classContext, propertyContext: classContext[key] });
  };
}

type AnyValidateablePropertyKey = ValidateablePropertyKey<
  Record<string, unknown>
>;
type ValidateablePropertyKey<T> = keyof T & string;

const CLASS_VALIDATION_METADATA_KEY = "class_validator:validation";
type AnyClassValidationContext = ClassValidationContext<
  Record<string, unknown>
>;
type ClassValidationContext<T> = {
  [K in keyof T]: ClassValidationPropertyContext<T[K]>;
};

type ClassValidationPropertyContext<TValue> = {
  designType: Constructor<TValue, unknown[]>;
  rules: ClassValidationPropertyRule<TValue>[];
  parsers: ClassValidationPropertyParser<TValue>[];
  allowNull: boolean;
  allowUndefined: boolean;
};

type ClassValidationPropertyRule<TValue> = {
  // TODO: useReturnValue: boolean or just overload with `parse` instead of `test`?
  name: string;
  test: (opts: { value: TValue }) => ValidationTestResult;
};

type ClassValidationPropertyParser<TValue> = {
  name: string;
  parse: (opts: { value: unknown }) => TValue;
};

type ValidationTestResult = string | "" | false | null | undefined;

export type Ok<T> = { ok: T };
export type Err<T> = { err: T };
export type Result<T, E> = Ok<T> | Err<E>;

function runCatching<T>(fn: () => T): Result<T, unknown> {
  try {
    return { ok: fn() };
  } catch (err) {
    return { err };
  }
}

function createPropertyAccessor<T, TKey extends keyof T>(
  object: T,
  key: TKey,
): { getValue(): T[TKey]; setValue(value: T[TKey]): T[TKey] } {
  return {
    getValue: () => object[key],
    setValue: (value: T[TKey]) => object[key] = value,
  };
}
