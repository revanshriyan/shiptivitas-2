const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');

const app = express();

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  return res.status(200).send({'message': 'SHIPTIVITY API. Read documentation to see API docs'});
});

// Open database connection
const db = new sqlite3.Database('./clients.db');

// Don't forget to close connection when server gets terminated
const closeDb = () => db.close();
process.on('SIGTERM', closeDb);
process.on('SIGINT', closeDb);

/**
 * Validate id input
 * @param {any} id
 */
const validateId = (id) => {
  if (Number.isNaN(id)) {
    return {
      valid: false,
      messageObj: {
      'message': 'Invalid id provided.',
      'long_message': 'Id can only be integer.',
      },
    };
  }
  return {
    valid: true,
  };
}

/**
 * Validate priority input
 * @param {any} priority
 */
const validatePriority = (priority) => {
  if (Number.isNaN(priority)) {
    return {
      valid: false,
      messageObj: {
      'message': 'Invalid priority provided.',
      'long_message': 'Priority can only be positive integer.',
      },
    };
  }
  return {
    valid: true,
  }
}

/**
 * Get all of the clients. Optional filter 'status'
 * GET /api/v1/clients?status={status} - list all clients, optional parameter status: 'backlog' | 'in-progress' | 'complete'
 */
app.get('/api/v1/clients', (req, res) => {
  const status = req.query.status;
  if (status) {
    // status can only be either 'backlog' | 'in-progress' | 'complete'
    if (status !== 'backlog' && status !== 'in-progress' && status !== 'complete') {
      return res.status(400).send({
        'message': 'Invalid status provided.',
        'long_message': 'Status can only be one of the following: [backlog | in-progress | complete].',
      });
    }
    db.all('select * from clients where status = ?', [status], (err, clients) => {
      if (err) return res.status(500).send(err);
      return res.status(200).send(clients);
    });
  } else {
    db.all('select * from clients', [], (err, clients) => {
      if (err) return res.status(500).send(err);
      return res.status(200).send(clients);
    });
  }
});

/**
 * Get a client based on the id provided.
 * GET /api/v1/clients/{client_id} - get client by id
 */
app.get('/api/v1/clients/:id', (req, res) => {
  const id = parseInt(req.params.id , 10);
  const { valid, messageObj } = validateId(id);
  if (!valid) {
    return res.status(400).send(messageObj);
  }
  db.get('select * from clients where id = ?', [id], (err, client) => {
    if (err) return res.status(500).send(err);
    if (!client) return res.status(404).send({'message': 'Client not found'});
    return res.status(200).send(client);
  });
});

/**
 * Update client information based on the parameters provided.
 * When status is provided, the client status will be changed
 * When priority is provided, the client priority will be changed with the rest of the clients accordingly
 * Note that priority = 1 means it has the highest priority (should be on top of the swimlane).
 * No client on the same status should not have the same priority.
 * This API should return list of clients on success
 *
 * PUT /api/v1/clients/{client_id} - change the status of a client
 *    Data:
 *      status (optional): 'backlog' | 'in-progress' | 'complete',
 *      priority (optional): integer,
 *
 */
app.put('/api/v1/clients/:id', (req, res) => {
  const id = parseInt(req.params.id , 10);
  
  if (Number.isNaN(id)) {
    return res.status(400).send({
      'message': 'Invalid id provided.',
      'long_message': 'Id can only be integer.',
    });
  }

  let { status, priority } = req.body;

  // Check if client exists
  db.get('select * from clients where id = ?', [id], (err, client) => {
    if (err) return res.status(500).send(err);
    if (!client) {
      return res.status(400).send({
        'message': 'Invalid id provided.',
        'long_message': 'Cannot find client with that id.',
      });
    }

    /* ---------- Update code below ----------*/

    // Update status if provided
    if (status) {
      if (status !== 'backlog' && status !== 'in-progress' && status !== 'complete') {
        return res.status(400).send({
          'message': 'Invalid status provided.',
          'long_message': 'Status can only be one of the following: [backlog | in-progress | complete].',
        });
      }
      db.run('update clients set status = ? where id = ?', [status, id]);
    }

    // Update priority if provided
    if (priority !== undefined && priority !== null) {
      if (Number.isNaN(parseInt(priority, 10))) {
        return res.status(400).send({
          'message': 'Invalid priority provided.',
          'long_message': 'Priority can only be positive integer.',
        });
      }

      // Get the new status (either updated status or current status)
      const newStatus = status || client.status;

      // Get all clients in the same status, ordered by priority
      db.all('select * from clients where status = ? order by priority', [newStatus], (err, statusClients) => {
        if (err) return res.status(500).send(err);

        // Remove the current client from the list
        const otherClients = statusClients.filter(c => c.id !== id);

        // Insert the client at the new priority position
        // Priority 1 = highest (top of swimlane)
        const newPriority = parseInt(priority, 10);

        // Update priorities of other clients to make room
        const updatePromises = [];
        for (let i = 0; i < otherClients.length; i++) {
          const currentPriority = i + 1;
          if (i + 1 >= newPriority) {
            // Shift down clients that are at or after the new position
            db.run('update clients set priority = ? where id = ?', [currentPriority + 1, otherClients[i].id]);
          } else {
            // Keep clients before the new position as-is
            db.run('update clients set priority = ? where id = ?', [currentPriority, otherClients[i].id]);
          }
        }

        // Set the moved client's priority
        db.run('update clients set priority = ? where id = ?', [newPriority, id], (err) => {
          if (err) return res.status(500).send(err);

          // Re-fetch all clients to return updated list
          db.all('select * from clients', [], (err, clients) => {
            if (err) return res.status(500).send(err);
            return res.status(200).send(clients);
          });
        });
      });
    } else {
      // No priority update, just return all clients
      db.all('select * from clients', [], (err, clients) => {
        if (err) return res.status(500).send(err);
        return res.status(200).send(clients);
      });
    }

    /* ---------- Update code above ----------*/
  });
});

app.listen(3001);
console.log('app running on port ', 3001);