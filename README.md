# IndexedDB Wrapper

A lightweight Promise-based wrapper to simplify the use of JavaScript IndexedDB.

## Features

- **Simplified API**: Provides a clean and easy-to-use interface for working with IndexedDB.
- **Promise-Based**: All operations return promises, making it easier to handle asynchronous tasks.
- **TypeScript Support**: Fully typed for enhanced developer experience.

## Installation

Install the package via npm:

```bash
npm install https://github.com/Eahnns12/indexeddb-wrapper
```

## Usage

Here's a quick example of how to use the library:

```javascript
import IDB from "@eahnns12/indexeddb-wrapper";

const schema = {
  name: "MyDatabase",
  version: 1,
  objectStores: [
    {
      name: "users",
      options: { keyPath: "id" },
      indexes: [{ name: "name", keyPath: "name", options: { unique: false } }],
    },
  ],
};

// Initialize the database
const db = new IDB(schema);

// Open the database
await db.open({
  onupgradeneeded: event => {
    console.log("Database upgrade needed:", event);
  },
});

// Add a record
await db.add("users", { id: 1, name: "John Doe" });

// Retrieve a record
const user = await db.get("users", 1);
console.log("Retrieved user:", user);

// Get all records
const users = await db.getAll("users");
console.log("All users:", users);

// Delete a record
await db.delete("users", 1);
```
