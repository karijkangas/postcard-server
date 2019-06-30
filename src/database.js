/*
 *
 */
const pg = require('pg');

const utils = require('./utils');
const config = require('./config');
const logger = require('./logger');

const { isValidId, inRange, emailHash } = utils;

let pool;

// ------------------------------------------------------------------

function isValidUserId(id) {
  return isValidId(id);
}

function isValidPostcardId(id) {
  return isValidId(id);
}

function isValidInviteId(id) {
  return isValidId(id);
}

function isValidIndex(index) {
  const i = typeof index === 'string' ? Number(index) : index;
  return Number.isInteger(i) && i >= 0;
}

function isValidLimit(limit) {
  const i = typeof limit === 'string' ? Number(limit) : limit;
  return Number.isInteger(i) && inRange(i, 1, config.queryLimit);
}

function isValidIndexAndLimit(index, limit) {
  return isValidIndex(index) && isValidLimit(limit);
}

function isRegisteredUser(user) {
  return (user && !!user.passhash) || false;
}

// ------------------------------------------------------------------

function initialize() {
  logger.info('database initialize');
  if (pool) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    try {
      pool = new pg.Pool(config.postgres);
      pool.on('error', (err /* , client */) => {
        logger.error(`database pool error: ${err}`);
      });
      pool.query('SELECT NOW()', err => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    } catch (e) {
      logger.error(`database initialize error: ${e}`);
      pool = undefined;
      reject(e);
    }
  });
}

function shutdown() {
  logger.info('database shutdown');
  if (!pool) {
    return Promise.resolve();
  }
  return new Promise((resolve /* , reject */) => {
    const p = pool;
    pool = undefined;
    p.end(resolve);
  });
}

/* ------------------------------------------------------------------ */

async function addOrModifyUser(user) {
  try {
    const res = await pool.query(
      `INSERT INTO "users" (
        "email",
        "passhash",
        "firstName",
        "lastName",
        "language"
        )
       VALUES (lower($1), $2, $3, $4, $5)
       ON CONFLICT ("email") DO UPDATE SET
        "passhash" = $2,
        "firstName" = $3,
        "lastName" = $4,
        "language" = $5
       RETURNING *;`,
      [user.email, user.passhash, user.firstName, user.lastName, user.language]
    );
    const u = res.rows[0];

    const hash = emailHash(user.email);

    // await pool
    //   .query(
    //     `DELETE FROM "invites" WHERE "user" = $1;
    //      DELETE FROM "ignored" WHERE "hash" = $2;`,
    //     [u.id, hash]
    //   )
    //   .catch(() => {});

    await Promise.all([
      pool
        .query(`DELETE FROM "invites" WHERE "user" = $1;`, [u.id])
        .catch(() => {}),
      pool
        .query(`DELETE FROM "ignored" WHERE "hash" = $1;`, [hash])
        .catch(() => {}),
    ]);

    return u;
  } catch (e) {
    // console.log(
    //   `>>>> database.addOrModifyUser exception: ${JSON.stringify(e, null, 2)}`
    // );
    switch (e.code) {
      case '23505':
        return undefined;
      default:
        throw e;
    }
  }

  // try {
  //   // const res = await pool.query(
  //   //    INSERT INTO "users" (
  //   //     "email",
  //   //     "passhash",
  //   //     "firstName",
  //   //     "lastName",
  //   //     "language"
  //   //     )
  //   //    VALUES (lower($1), $2, $3, $4, $5)
  //   //    ON CONFLICT ("email") DO UPDATE SET
  //   //     "passhash" = $2,
  //   //     "firstName" = $3,
  //   //     "lastName" = $4,
  //   //     "language" = $5
  //   //    RETURNING *;`,
  //   //   [user.email, user.passhash, user.firstName, user.lastName, user.language]
  //   // );
  //   const u = res.rows[0];
  //   // await pool.query(`DELETE FROM "invites" WHERE "user" = $1;`, [u.id]);
  //   return u;
  // } catch (e) {
  //   console.log(
  //     `>>>> database.addOrModifyUser exception: ${JSON.stringify(e, null, 2)}`
  //   );
  //   switch (e.code) {
  //     case '23505':
  //       return undefined;
  //     default:
  //       throw e;
  //   }
  // }
}

async function getUser(id) {
  const res = await pool.query(
    `SELECT * FROM "users"
     WHERE "id" = $1
     LIMIT 1;`,
    [id]
  );
  return res.rows[0];
}

async function getUsers(ids) {
  const validIds = ids.filter(isValidUserId);
  if (validIds.length === 0) {
    return [];
  }
  const res = await pool.query(
    `SELECT * FROM "users"
     WHERE "id" = ANY ($1);`,
    [validIds]
  );
  return res.rows.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
}

async function findUser(email) {
  const res = await pool.query(
    `SELECT * FROM "users"
     WHERE "email" = lower($1)
     LIMIT 1;`,
    [email]
  );
  return res.rows[0];
}

// async function addOrFindUser(email) {
//   const res = await pool.query(
//     `WITH "ins" AS (
//       INSERT INTO "users" ("email")
//       VALUES (lower($1))
//       ON CONFLICT ON CONSTRAINT "users_email_key" DO UPDATE
//       SET "email" = NULL
//       WHERE FALSE
//       RETURNING *
//      )
//      SELECT * FROM "ins"
//      UNION ALL
//      SELECT * FROM "users"
//      WHERE "email" = lower($1)
//      LIMIT 1;`,
//     [email]
//   );
//   return res.rows[0];
// }

function keysAndValues(data, mutableKeys) {
  const keys = Object.keys(data).filter(key => mutableKeys.includes(key));
  if (keys.length === 0) {
    return {};
  }
  const setString = keys
    .map((key, index) => `"${key}" = $${index + 2}`)
    .join(', ');
  const setValues = keys.map(key => data[key]);
  const oldValues = keys.map(key => `old."${key}" AS "old_${key}"`).join(', ');

  return { setString, setValues, oldValues };
}

async function modifyUser(id, user) {
  const mutableKeys = [
    'email',
    'firstName',
    'lastName',
    'passhash',
    'language',
    'avatar',
  ];
  // const keys = Object.keys(user).filter(key => mutableKeys.includes(key));
  // if (keys.length === 0) {
  //   return getUser(id);
  // }
  // const setString = keys
  //   .map((key, index) => `"${key}" = $${index + 2}`)
  //   .join(', ');
  // const setValues = keys.map(key => user[key]);

  const { setString, setValues, oldValues } = keysAndValues(user, mutableKeys);
  if (!setString || !setValues) {
    return getUser(id);
  }

  // const res = await pool.query(
  //   `UPDATE "users"
  //     SET ${setString}
  //     WHERE id = $1
  //     RETURNING *;`,
  //   [id, ...setValues]
  // );
  const res = await pool.query(
    `UPDATE "users" new
      SET ${setString} 
      FROM "users" old
      WHERE new.id = old.id AND new.id = $1
      RETURNING new.*, ${oldValues};`,
    [id, ...setValues]
  );
  return res.rows[0];
}

async function deleteUser(id) {
  const res = await pool.query(
    `DELETE FROM "users"
     WHERE "id" = $1
     RETURNING *;`,
    [id]
  );
  return res.rows[0];
}

/* ------------------------------------------------------------------ */

async function getConnections(userId, excludedStartIndex, limit) {
  const res = await pool.query(
    `SELECT 
      "connections"."index",
      "users"."id", 
      "users"."firstName", 
      "users"."lastName", 
      "users"."email", 
      "users"."avatar" 
     FROM "connections", "users"
     WHERE
      "connections"."index" > $1 AND
      "connections"."user" = $2 AND 
      "connections"."friend" = "users"."id"
     ORDER BY "connections"."index" ASC
     LIMIT $3;`,
    [excludedStartIndex, userId, limit]
  );
  return res.rows;
}

async function deleteConnection(userId, friendId) {
  if (!isValidUserId(friendId)) {
    return undefined;
  }
  const res = await pool.query(
    `DELETE FROM "connections"
     WHERE "user" = $1 AND "friend" = $2
     RETURNING *;`,
    [userId, friendId]
  );
  return res.rows[0];
}

/* ------------------------------------------------------------------ */

async function addBlocked(userId, blockedId) {
  if (!isValidUserId(blockedId)) {
    return undefined;
  }
  try {
    const res = await pool.query(
      // `INSERT INTO "blocked" (
      //   "user",
      //   "blocked"
      //   )
      // VALUES ($1, $2)
      // ON CONFLICT DO NOTHING
      // RETURNING *;`,
      `WITH "ins" AS (
      INSERT INTO "blocked" ("user", "blocked")
      VALUES ($1, $2)
      ON CONFLICT ("user", "blocked") DO UPDATE
      SET "user" = NULL, "blocked" = NULL
      WHERE FALSE
      RETURNING *
     )
     SELECT * FROM "ins"
     UNION ALL
     SELECT * FROM "blocked"
     WHERE "user" = $1 AND "blocked" = $2
     LIMIT 1;`,
      [userId, blockedId]
    );
    return res.rows[0];
  } catch (e) {
    // console.log(
    //   `>>>> database.addBlocked exception: ${JSON.stringify(e, null, 2)}`
    // );
    switch (e.code) {
      case '23503':
      case '23505':
        return undefined;
      default:
        throw e;
    }
  }
}

async function getBlocked(userId, excludedStartIndex, limit) {
  const res = await pool.query(
    `SELECT 
      "blocked"."index",
      "users"."id", 
      "users"."firstName", 
      "users"."lastName", 
      "users"."email", 
      "users"."avatar" 
     FROM "blocked", "users"
     WHERE
      "blocked"."index" > $1 AND
      "blocked"."user" = $2 AND 
      "blocked"."blocked" = "users"."id"
     ORDER BY "blocked"."index" ASC
     LIMIT $3;`,
    [excludedStartIndex, userId, limit]
  );
  return res.rows;
}

async function isBlocked(receiver, sender) {
  const res = await pool.query(
    `SELECT * FROM "blocked"
     WHERE "user" = $1 AND "blocked" = $2
     LIMIT 1;`,
    [receiver, sender]
  );
  return !!res.rows[0];
}

async function deleteBlocked(userId, blockedId) {
  const res = await pool.query(
    `DELETE FROM "blocked"
     WHERE "user" = $1 AND "blocked" = $2
     RETURNING *;`,
    [userId, blockedId]
  );
  return res.rows[0];
}

/* ------------------------------------------------------------------ */

async function addPostcard(postcard) {
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const res1 = await client.query(
      `INSERT INTO "postcards" (
        "sender", 
        "receiver", 
        "image", 
        "message", 
        "location"
        )
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *;`,
      [
        postcard.sender,
        postcard.receiver,
        postcard.image,
        postcard.message,
        postcard.location,
      ]
    );
    const p = res1.rows[0];

    // await client.query(
    //   `INSERT INTO "inbox" (
    //     "user",
    //     "postcard"
    //     )
    //   VALUES ($2, $1);
    //   INSERT INTO "sent" (
    //     "user",
    //     "postcard"
    //     )
    //   VALUES ($3, $1);`,
    //   [p.id, postcard.receiver, postcard.sender]
    // );

    await Promise.all([
      client.query(
        `INSERT INTO "inbox" (
        "user",
        "postcard"
        )
      VALUES ($1, $2);`,
        [postcard.receiver, p.id]
      ),
      client.query(
        `INSERT INTO "sent" (
        "user",
        "postcard"
        )
      VALUES ($1, $2)
      RETURNING *;`,
        [postcard.sender, p.id]
      ),
    ]);
    await client.query('COMMIT');
    return p;
  } catch (e) {
    if (client) {
      await client.query('ROLLBACK');
    }
    // console.log(
    //   `>>>> database.addPostcard exception: ${JSON.stringify(e, null, 2)}`
    // );
    switch (e.code) {
      case '23505':
        return undefined;
      default:
        throw e;
    }
  } finally {
    if (client) {
      client.release();
    }
  }
}

// async function getPostcard(id) {
//   const res = await pool.query(
//     `SELECT * FROM "postcards"
//      WHERE "id" = $1
//      LIMIT 1;`,
//     [id]
//   );
//   return res.rows[0];
// }

async function getPostcards(userId, ids) {
  const validIds = ids.filter(isValidPostcardId);
  if (validIds.length === 0) {
    return [];
  }
  const res = await pool.query(
    `SELECT * FROM "postcards"
     WHERE 
      ("id" = ANY ($2)) AND
      ("sender" = $1 OR "receiver" = $1);`,
    [userId, validIds]
  );
  return res.rows.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
  // return res.rows;
}

async function getInbox(userId, excludedStartIndex, limit) {
  const res = await pool.query(
    // `SELECT
    //   "inbox"."index",
    //   "postcards"."sender",
    //   "postcards"."image",
    //   "postcards"."message",
    //   "postcards"."location",
    //   "postcards"."created",
    //   "postcards"."read"
    //  FROM "inbox", "postcards"
    //  WHERE
    //   "inbox"."index" > $1 AND
    //   "inbox"."user" = $2 AND
    //   "inbox"."postcard" = "postcards"."id"
    //  ORDER BY "inbox"."index" ASC
    //  LIMIT $3;`,
    `SELECT *
     FROM "inbox"
      WHERE
      "index" > $1 AND
      "user" = $2
      ORDER BY "index" ASC
      LIMIT $3;`,
    [excludedStartIndex, userId, limit]
  );
  return res.rows;
}

async function removeFromInbox(userId, index) {
  if (!isValidIndex(index)) {
    return undefined;
  }
  const res = await pool.query(
    `DELETE FROM "inbox"
     WHERE
      "index" = $1 AND
      "user" = $2
     RETURNING *;`,
    [index, userId]
  );
  return res.rows[0];
}

// async function setAsRead(userId, index) {
//   const res1 = await pool.query(
//     `SELECT
//       "postcard"
//      FROM "inbox"
//      WHERE
//       "index" = $1 AND
//       "user" = $2
//      LIMIT 1;`,
//     [index, userId]
//   );
//   if (res1.rows.length !== 1) {
//     return undefined;
//   }
//   const { postcard } = res1.rows[0];
//   const res2 = await pool.query(
//     `UPDATE "postcards"
//       SET read = now()
//       WHERE
//         "id" = $1 AND
//         "read" IS NULL
//       RETURNING *;`,
//     [postcard]
//   );
//   return res2.rows[0] || {};
// }
async function setAsRead(userId, postcardId) {
  if (!isValidPostcardId(postcardId)) {
    return undefined;
  }
  const res = await pool.query(
    `WITH
      "set_read" AS (
        UPDATE "postcards"
        SET "read" = now()
        WHERE
          "id" = $1 AND
          "receiver" = $2 AND
          "read" IS NULL
        RETURNING *)
    SELECT * from "set_read"
    UNION ALL
    SELECT * FROM "postcards"
    WHERE
      "id" = $1 AND
      "receiver" = $2 AND
      "read" IS NOT NULL;`,
    [postcardId, userId]
  );
  return res.rows[0];
}

// async function connectWithSender(userId, index) {
//   try {
//     const res = await pool.query(
//       `WITH
//        "select_postcard" AS (
//         SELECT
//           "postcards"."sender" AS "sender_id",
//           "postcards"."receiver" AS "receiver_id"
//         FROM "inbox", "postcards"
//         WHERE
//           "inbox"."index" = $1 AND
//           "inbox"."user" = $2 AND
//           "inbox"."postcard" = "postcards"."id"
//         LIMIT 1
//        ),
//        "insert_connections" AS (
//         INSERT INTO "connections" ("user", "friend")
//         (SELECT "sender_id", "receiver_id" FROM "select_postcard"
//         UNION
//         SELECT "receiver_id", "sender_id" FROM "select_postcard")
//         ON CONFLICT ("user", "friend") DO UPDATE
//         SET "user" = NULL, "friend" = NULL
//         WHERE FALSE
//         RETURNING *
//        )
//        SELECT * FROM "insert_connections"
//        UNION ALL
//        SELECT * FROM "connections"
//        WHERE
//          ("user" = $2 AND "friend" = (SELECT "sender_id" FROM "select_postcard")) OR
//          ("user" = (SELECT "receiver_id" FROM "select_postcard") AND "friend" = $2)
//        LIMIT 2;`,
//       [index, userId]
//     );
//     return res.rows;
//   } catch (e) {
//     console.log(
//       `>>>> database.connectWithSender exception: ${JSON.stringify(e, null, 2)}`
//     );
//     switch (e.code) {
//       case '23502':
//       case '23505':
//         return undefined;
//       default:
//         throw e;
//     }
//   }
// }

async function connectWithSender(userId, postcardId) {
  if (!isValidPostcardId(postcardId)) {
    return undefined;
  }
  try {
    const res = await pool.query(
      `WITH
       "select_postcard" AS (
        SELECT 
          "sender" AS "sender_id", 
          "receiver" AS "receiver_id"
        FROM "postcards"
        WHERE
          "id" = $2 AND
          "receiver" = $1
        LIMIT 1
       ),
       "insert_connections" AS (
        INSERT INTO "connections" ("user", "friend")
        (SELECT "sender_id", "receiver_id" FROM "select_postcard"
        UNION
        SELECT "receiver_id", "sender_id" FROM "select_postcard")
        ON CONFLICT ("user", "friend") DO UPDATE
        SET "user" = NULL, "friend" = NULL
        WHERE FALSE
        RETURNING *
       )
       SELECT * FROM "insert_connections"
       UNION ALL
       SELECT * FROM "connections"
       WHERE
         ("user" = $1 AND "friend" = (SELECT "sender_id" FROM "select_postcard")) OR
         ("user" = (SELECT "receiver_id" FROM "select_postcard") AND "friend" = $1)
       LIMIT 2;`,
      [userId, postcardId]
    );
    return res.rows.length >= 1
      ? {
          user: res.rows.find(u => u.user === userId).user,
          sender: res.rows.find(u => u.user === userId).friend,
        }
      : undefined;
  } catch (e) {
    // console.log(
    //   `>>>> database.connectWithSender exception: ${JSON.stringify(e, null, 2)}`
    // );
    switch (e.code) {
      case '23502':
      case '23505':
        return undefined;
      default:
        throw e;
    }
  }
}

// async function getSent(userId, excludedStartIndex, limit) {
//   const res = await pool.query(
//     `SELECT
//       "sent"."index",
//       "postcards"."receiver",
//       "postcards"."image",
//       "postcards"."message",
//       "postcards"."location",
//       "postcards"."created",
//       "postcards"."read"
//      FROM "sent", "postcards"
//      WHERE
//       "sent"."index" > $1 AND
//       "sent"."user" = $2 AND
//       "sent"."postcard" = "postcards"."id"
//      ORDER BY "sent"."index" ASC
//      LIMIT $3;`,
//     [excludedStartIndex, userId, limit]
//   );
//   return res.rows;
// }
async function getSent(userId, excludedStartIndex, limit) {
  const res = await pool.query(
    `SELECT *
     FROM "sent"
     WHERE
      "index" > $1 AND
      "user" = $2
     ORDER BY "index" ASC
     LIMIT $3;`,
    [excludedStartIndex, userId, limit]
  );
  return res.rows;
}

async function removeFromSent(userId, index) {
  if (!isValidIndex(index)) {
    return undefined;
  }
  const res = await pool.query(
    `DELETE FROM "sent"
     WHERE
      "index" = $1 AND
      "user" = $2
     RETURNING *;`,
    [index, userId]
  );
  return res.rows[0];
}

// async function modifyPostcard(id, postcard) {
//   const mutableKeys = ['read'];
//   // const keys = Object.keys(postcard).filter(key => mutableKeys.includes(key));
//   // if (keys.length === 0) {
//   //   return getUser(id);
//   // }
//   // const setString = keys
//   //   .map((key, index) => `"${key}" = $${index + 2}`)
//   //   .join(', ');
//   // const setValues = keys.map(key => postcard[key]);

//   const { setString, setValues } = keysAndValues(postcard, mutableKeys);

//   const res = await pool.query(
//     `UPDATE "postcards"
//       SET ${setString}
//       WHERE "id" = $1
//       RETURNING *;`,
//     [id, ...setValues]
//   );
//   return res.rows[0];
// }

async function deletePostcard(id) {
  const res = await pool.query(
    `DELETE FROM "postcards"
     WHERE "id" = $1
     RETURNING *;`,
    [id]
  );
  return res.rows[0];
}

/* ------------------------------------------------------------------ */

async function addInvite(email) {
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    let res = await client.query(
      `WITH "ins" AS (
      INSERT INTO "users" ("email")
      VALUES (lower($1))
      ON CONFLICT ("email") DO UPDATE
      SET "email" = NULL
      WHERE FALSE
      RETURNING *
     )
     SELECT * FROM "ins"
     UNION ALL
     SELECT * FROM "users"
     WHERE "email" = lower($1)
     LIMIT 1;`,
      [email]
    );
    const [user] = res.rows;
    let invite;
    if (!isRegisteredUser(user)) {
      res = await client.query(
        `INSERT INTO "invites" (
          "user"
          )
        VALUES ($1)
        RETURNING *;`,
        [user.id]
      );
      [invite] = res.rows;
      // console.log('>>>>>>>>>> 2', JSON.stringify(res, null, 2));
    }
    await client.query('COMMIT');
    return { user, invite };
  } catch (e) {
    if (client) {
      await client.query('ROLLBACK');
    }
    // console.log(
    //   `>>>> database.addInvite exception: ${JSON.stringify(e, null, 2)}`
    // );
    switch (e.code) {
      case '23503':
      case '23505':
        return undefined;
      default:
        throw e;
    }
  } finally {
    if (client) {
      client.release();
    }
  }
}

// async function getInvite(id) {
//   const res = await pool.query(
//     `SELECT * FROM "invites"
//      WHERE "id" = $1
//      LIMIT 1;`,
//     [id]
//   );
//   return res.rows[0];
// }

async function deleteInvite(id) {
  if (!isValidInviteId(id)) {
    return undefined;
  }
  const res = await pool.query(
    `DELETE FROM "invites"
    WHERE "id" = $1
    RETURNING *;`,
    [id]
  );
  return res.rows[0];
}

/* ------------------------------------------------------------------ */

async function ignore(email) {
  const hash = emailHash(email);
  try {
    await pool.query(
      `INSERT INTO "ignored" (
        "hash"
        )
      VALUES ($1)
      ON CONFLICT DO NOTHING;`,
      [hash]
    );
    return true;
  } catch (e) {
    // console.log(
    //   `>>>> database.ignore exception: ${JSON.stringify(e, null, 2)}`
    // );
    switch (e.code) {
      case '23505':
        return false;
      default:
        throw e;
    }
  }
}

async function isIgnored(email) {
  const hash = emailHash(email);
  const res = await pool.query(
    `SELECT * FROM "ignored"
     WHERE "hash" = $1
     LIMIT 1;`,
    [hash]
  );
  return !!res.rows[0];
}

// async function clearIgnored(email) {
//   const hash = emailHash(email);
//   const res = await pool.query(
//     `DELETE FROM "ignored"
//      WHERE "hash" = $1
//      RETURNING *;`,
//     [hash]
//   );
//   return !!res.rows[0];
// }

module.exports = {
  isValidUserId,
  isValidPostcardId,
  isValidInviteId,
  isValidIndex,
  isValidLimit,
  isValidIndexAndLimit,
  isRegisteredUser,
  initialize,
  shutdown,
  addOrModifyUser,
  getUser,
  getUsers,
  findUser,
  // addOrFindUser,
  modifyUser,
  deleteUser,
  connectWithSender,
  getConnections,
  deleteConnection,
  addBlocked,
  getBlocked,
  isBlocked,
  deleteBlocked,
  addPostcard,
  // getPostcard,
  getPostcards,
  getInbox,
  removeFromInbox,
  setAsRead,
  getSent,
  removeFromSent,
  deletePostcard,
  addInvite,
  deleteInvite,
  ignore,
  isIgnored,
  // clearIgnored,
};

/* ------------------------------------------------------------------ */
/* eslint-disable no-inner-declarations */
if (process.env.NODE_ENV !== 'production') {
  async function devAddUser(user) {
    const res = await pool.query(
      `INSERT INTO "users" (
        "email", 
        "passhash", 
        "firstName", 
        "lastName", 
        "language"
        )
      VALUES (lower($1), $2, $3, $4, $5)
      RETURNING *;`,
      [user.email, user.passhash, user.firstName, user.lastName, user.language]
    );
    return res.rows[0];
  }
  async function devGetUsers() {
    const res = await pool.query(`SELECT * FROM "users";`);
    return res.rows;
  }

  async function devClearUsers() {
    await pool.query(`DELETE FROM "users";`);
  }

  async function devAddConnection(userId, friendId) {
    const res = await pool.query(
      `WITH "ins" AS (
        INSERT INTO "connections" ("user", "friend")
        VALUES ($1, $2), ($2, $1)
        ON CONFLICT ("user", "friend") DO UPDATE
        SET "user" = NULL, "friend" = NULL
        WHERE FALSE
        RETURNING *
       )
       SELECT * FROM "ins"
       UNION ALL
       SELECT * FROM "connections"
       WHERE
         ("user" = $1 AND "friend" = $2) OR
         ("user" = $2 AND "friend" = $1)
       LIMIT 2;`,
      [userId, friendId]
    );
    return res.rows;
  }

  async function devClearConnections() {
    await pool.query(`DELETE FROM "connections";`);
  }

  async function devClearBlocked() {
    await pool.query(`DELETE FROM "blocked";`);
  }

  async function devGetPostcards() {
    const res = await pool.query(`SELECT * FROM "postcards";`);
    return res.rows;
  }

  async function devClearPostcards() {
    await pool.query(`DELETE FROM "postcards";`);
  }

  async function devGetInvites() {
    const res = await pool.query(`SELECT * FROM "invites";`);
    return res.rows;
  }

  async function devClearInvites() {
    await pool.query(`DELETE FROM "invites";`);
  }

  async function devGetIgnored() {
    const res = await pool.query(`SELECT * FROM "ignored";`);
    return res.rows;
  }

  async function devClearIgnored() {
    await pool.query(`DELETE FROM "ignored";`);
  }

  module.exports = {
    ...module.exports,
    devAddUser,
    devGetUsers,
    devClearUsers,
    devAddConnection,
    devClearConnections,
    devClearBlocked,
    devGetPostcards,
    devClearPostcards,
    devGetInvites,
    devClearInvites,
    devGetIgnored,
    devClearIgnored,
  };
}
