const { User, Cafe, Session, Transaction, DetailedTransaction, Table, sequelize } = require('../models');
const { sendEmail } = require('../services/emailServices');
const { generateUniqueUsername } = require('../helpers/createGuestHelper');

// Helper function to generate a token
function generateToken() {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

// Helper function to validate email format
function isValidEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

exports.transactionFromClerk = async (req, res) => {
  const { cafeId } = req.params;

  const cafe = await Cafe.findByPk(cafeId);
  if (!cafe) return res.status(404).json({ error: 'Cafe not found' });

  if (req.user.cafeId != cafe.cafeId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { user_email, payment_type, serving_type, tableNo, transactions } = req.body;

  let userEmail = user_email !== null ? user_email : 'null';
  if (userEmail != 'null' && !isValidEmail(userEmail)) {
    return res.status(400).json({ error: 'Invalid email format' });
  }

  let paymentType = payment_type === 'cash' ? 'cash' : 'cashless';
  let servingType = serving_type === 'pickup' ? 'pickup' : 'serve';
  let tableId;

  if (tableNo || servingType == 'serve') {
    const table = await Table.findOne({ where: { cafeId: cafeId, tableNo: tableNo } });
    if (!table) return res.status(404).json({ error: 'Table not found' });

    tableId = table.tableId;
  }

  const user = await User.findOne({ where: { email: user_email } });
  let userId;
  if (!user) {
    // Create user with a default password
    const newUsername = await generateUniqueUsername();
    const newUser = await User.create({
      email: userEmail,
      username: newUsername,
      password: 'unsetunsetunset',
      roleId: 3
    });
    userId = newUser.userId;
  } else {
    userId = user.userId;
  }

  try {
    await sequelize.transaction(async (t) => {
      // Create the main transaction record
      const newTransaction = await Transaction.create({
        clerkId: req.user.userId,
        userId: userId,
        cafeId: cafeId,
        payment_type: paymentType,
        serving_type: servingType,
        tableId: servingType === 'serve' ? tableId : null,
        is_paid: paymentType === 'cash' ? true : false
      }, { transaction: t });

      // Create detailed transaction records
      const detailedTransactions = transactions.items.map(async (item) => {
        await DetailedTransaction.create({
          transactionId: newTransaction.transactionId,
          itemId: item.itemId,
          qty: item.qty
        }, { transaction: t });
      });

      await Promise.all(detailedTransactions);

      if (!user) {
        const token = generateToken();
        await Session.create({ userId: userId, token }, { transaction: t });

        // Send an email to create an account
        await sendEmail(user_email, cafe, 'invite', transactions.items, token);
      } else if (user.password === 'unsetunsetunset') {
        // Send email to complete registration
        const token = generateToken();
        await Session.create({ userId: userId, token }, { transaction: t });
        await sendEmail(user_email, cafe, 'completeRegistration', transactions.items, token);
      } else {
        // Send transaction notification email
        await sendEmail(user_email, cafe, 'transactionNotification', transactions.items);
      }
    });

    res.status(201).json({ message: 'Transactions created successfully' });
  } catch (error) {
    console.error('Error creating transactions:', error);
    res.status(500).json({ message: 'Failed to create transactions' });
  }
};

exports.transactionFromGuest = async (req, res) => {
  //userId is guest who transacte
  const { itemId, qty, payment_type } = req.body;
  try {
    const transaction = await Transaction.create({ itemId, qty, userId: req.user.userId, payment_type });

    res.status(201).json(transaction);
  } catch (error) {
    console.error('Error creating table:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.getTransaction = async (req, res) => {
  const { transactionId } = req.params;

  try {
    const transaction = await Transaction.findByPk(transactionId);

    res.status(200).json(transaction);
  } catch (error) {
    console.error('Error updating table:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Controller to update a user
exports.endCashTransaction = async (req, res) => {
  const { transactionId } = req.params;

  try {
    const transaction = await Transaction.findByPk(transactionId);

    if (!transaction || transaction.payment_type != "cash") return res.status(403);

    transaction.is_paid = true;
    await transaction.save();

    res.status(200).json(table);
  } catch (error) {
    console.error('Error updating table:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};