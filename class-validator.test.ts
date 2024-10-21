import { expect } from "@std/expect";
import { describe, it } from "@std/testing/bdd";
import {
  createValidated,
  IsOptional,
  type Ok,
  Parse,
  Rule,
  ValdidateDesignType,
} from "./class-validator.ts";

it(function createsAnInstanceOfTheValidatedClass() {
  class Person {
    @ValdidateDesignType()
    name!: string;

    @ValdidateDesignType()
    age!: number;
  }
  const data = { name: "Test", age: -1 };

  const validatedResult = createValidated(Person, data);

  expect(validatedResult).toEqual({ ok: expect.any(Person) });
  expect((validatedResult as Ok<Person>).ok.name).toBe("Test");
  expect((validatedResult as Ok<Person>).ok.age).toBe(-1);
});

it(function returnsTheErrorsOfTheValidatedProperties() {
  class Person {
    @ValdidateDesignType()
    name!: string;

    @ValdidateDesignType()
    age!: number;
  }
  const data = { name: 12 };

  const validatedResult = createValidated(Person, data);

  expect(validatedResult).toEqual({
    err: [
      "validate-design-type(name): Expected `String`, but got `12`",
      "validate-design-type(age): Expected `Number`, but got `undefined`",
    ],
  });
});

describe(function checksInstancesOfCustomClasses() {
  class Wallet {
    constructor(public amount: number = 0) {}
  }

  class Person {
    @ValdidateDesignType()
    name!: string;

    @ValdidateDesignType()
    wallet!: Wallet;
  }

  it(function returnsAnErrorWhenDataIsNotInstanceOfTheClass() {
    const data = { name: "Test", wallet: 0 };

    const validatedResult = createValidated(Person, data);

    expect(validatedResult).toEqual({
      err: [
        "validate-design-type(wallet): Expected `Wallet`, but got `0`",
      ],
    });
  });

  it(function succeedsWhenDataIsOfCorrectInstance() {
    const data = { name: "Test", wallet: new Wallet(120) };

    const validatedResult = createValidated(Person, data);

    expect((validatedResult as Ok<Person>).ok.wallet).toBeInstanceOf(Wallet);
    expect((validatedResult as Ok<Person>).ok.wallet.amount).toEqual(120);
  });
});

it(function createsInstancesOfNestedClasses() {
  class Wallet {
    @ValdidateDesignType()
    amount!: number;
  }

  class Person {
    @ValdidateDesignType()
    name!: string;

    @ValdidateDesignType()
    wallet!: Wallet;
  }

  const data = { name: "Test", wallet: { amount: 120 } };

  const validatedResult = createValidated(Person, data);

  expect((validatedResult as Ok<Person>).ok.wallet).toBeInstanceOf(Wallet);
  expect((validatedResult as Ok<Person>).ok.wallet.amount).toEqual(120);
});

it(function supportsCustomRules() {
  class Person {
    @Rule(({ value }) => value > 18 ? null : "Min Age 18")
    age!: number;
  }
  const data = { age: 12 };

  const validatedResult = createValidated(Person, data);

  expect(validatedResult).toEqual({
    err: [
      "custom-rule(age): Min Age 18",
    ],
  });
});

describe(function worksWithOptionalTypes() {
  class Person {
    @ValdidateDesignType()
    @Rule(({ value }) => value <= 18 && "Min Age 18")
    @IsOptional()
    age!: number;
  }

  it(function skipsValidationWhenOptional() {
    const data = {};

    const validatedResult = createValidated(Person, data);

    expect(validatedResult).toEqual({ ok: { age: undefined } });
  });

  it(function validateWhenDataIsPresent() {
    const data = { age: 12 };

    const validatedResult = createValidated(Person, data);

    expect(validatedResult).toEqual({ err: ["custom-rule(age): Min Age 18"] });
  });
});

describe(function typeParsing() {
  let timesValidationCalled = 0;

  class Person {
    @Parse(({ value }) => {
      timesValidationCalled += 1;

      if (typeof value === "number") {
        return value;
      }

      return null;
    })
    age!: number | null;
  }

  it(function transformsUsingTheParser() {
    expect(timesValidationCalled).toBe(0);
    const data = { age: undefined };

    const validatedResult = createValidated(Person, data);

    expect((validatedResult as Ok<Person>).ok.age).toBe(null);
    expect(timesValidationCalled).toBe(1);
  });
});
