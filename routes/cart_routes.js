
/*
Add Itemlisting	                cart/add-itemlisting	       POST	token, listingId
Update Itemlisting	            cart/update-itemlisting	       PUT	token, listingId, updateCount
Remove Itemlisting	            cart/remove-itemlisting	       DELETE	token, listingId
Fetch Cart	                    cart/fetch-cart	                GET	token 
Flush Cart	                    cart/flush	                    DELETE	token
Get Payment Information	        cart/get-payment-information	GET	token
Add Payment Information	        cart/add-payment-information	POST	token, nameOnCard, billingAddress, CardNumber
Fetch ddress	                cart/fetch-address	            GET	token
Get Shipping charges and taxes	cart/display-shipping-charges	GET	token, selectedAddressStateCode
Check Promo Code	            cart/check-promo-code	        GET	promoCode
Calculate Final Cost	        cart/get-final-cost	            GET	token, promoCode, selectedAddressStateCode
Checkout	                    cart/checkout	                POST	token, selectedAddress, promoCode
*/

const { Sequelize } = require('sequelize');
const express = require("express");
const EasyPostClient = require('@easypost/api');
const sendOTP  = require("../services/controller");
const router = express.Router();
const db = require('../models');
const { where } = require('sequelize');
const cart = require("../models/cart");
const userUtil = require("../util/userUtil");
const UserUtil = require("../util/userUtil");
const authent = userUtil.authent;
const User = db.User;
const EndUser = db.EndUsers;
const Cart = db.Cart;
const ItemListing = db.ItemListing;
const Purchase =  db.Purchase;
const Order = db.Order;


const Catalog = db.Catalog;
const Promocode = db.Promocode;
const stripe = require("stripe")('sk_test_51O49dTDB1UugWx3SlwFKiiQc8JDwiBU5QX343MsHyZKRmgXN16V4vYSn46NOjm1pSHXgF6kXiDL9FZ2MkuYe17xH00Vx06mKID');

router.use(express.urlencoded({ extended: true }));

async function get_cart(userId,filter=true, include_cart_id = true)
{
    let cartDetails = [];
    let listingIds = [];

    const cartDetailsSQL = await Cart.findAll({where:{userId:userId}})

    for (var i = 0; i < cartDetailsSQL.length; i++) 
    {

        // listing id and quantity for each listing in cart
        var listingId = cartDetailsSQL[i].dataValues.listingId;
        var quantity = cartDetailsSQL[i].dataValues.quantity;
        var cartId = cartDetailsSQL[i].dataValues.cartId;

        //append listing id and quantity to cartDetails

        if(include_cart_id)
        {
            cartDetails.push({listingId:listingId, quantity:quantity, cartId:cartId});
        }
        else
        {
            cartDetails.push({listingId:listingId, quantity:quantity});
        }
        
        //append listing id to listingIds
        listingIds.push(listingId);
    
    }

    //get the result of listing details from db
    const listingDetailsSQL = await ItemListing.findAll({where:{listingId:listingIds}});

    itemIDs = []

    // add name and price to cartDetails for that listing id
    for (var i = 0; i < cartDetails.length; i++) 
    {
        for (var j = 0; j < listingDetailsSQL.length; j++) 
        {
            if(cartDetails[i].listingId == listingDetailsSQL[j].dataValues.listingId)
            {
                cartDetails[i].price = listingDetailsSQL[j].dataValues.price.toFixed(2);
                cartDetails[i].max_quantity = listingDetailsSQL[j].dataValues.quantity;
                itemIDs.push(listingDetailsSQL[j].dataValues.itemId);
            }
        }
    }

    //get name from catalog for each item id
    const itemDetailsSQL = await Catalog.findAll({where:{itemId:itemIDs}});

    // add name to cartDetails for that listing id

    for (var i = 0; i < cartDetails.length; i++)
    {
        for (var j = 0; j < itemDetailsSQL.length; j++) 
        {
            if(itemDetailsSQL[j].dataValues.itemId == itemIDs[i])
            {
                cartDetails[i].name = itemDetailsSQL[j].dataValues.name;
            }
        }
    }

    if(filter)
    {
        cartDetails = cartDetails.filter(item => item.max_quantity !== 0);
        console.log("cartDetails inide filter: ", cartDetails);
    }

    return cartDetails;
}

async function getCartMaxQty(cartDetails)
{
    let cart_max_qty=0;

    console.log("getCartMaxQty inside ------------------------",cartDetails);

    for (var i = 0; i < cartDetails.length; i++)
    {
        cart_max_qty += cartDetails[i].max_quantity;
    }
    return cart_max_qty;
}

async function checkPromoCode(promoCode,total_price)
{
    //check if promoCode exists in db
    const promoCodeData = await Promocode.findOne({where:{promocode:promoCode}});

    console.log("promoCodeData: ", promoCodeData);

    if(!promoCodeData || promoCodeData.dataValues.is_active == false)
    {
        statusCode = 400;
        promocode_discount = 0;
        promocode_discount_string = "Promocode is not active";
        return [promocode_discount, promocode_discount_string,statusCode];
    }
    else
    {
        statusCode = 200;
        const discount_percent = promoCodeData.dataValues.discount_percent;
        promocode_discount = total_price*discount_percent/100;
        const max_discount = promoCodeData.dataValues.max_discount;

        if(promocode_discount > max_discount)
        {
            promocode_discount = max_discount;
        }
        else
        {
            promocode_discount = promocode_discount;
        }
    }
    promocode_discount_string = "Promocode Discount Applied : "+promocode_discount;
    return [promocode_discount, promocode_discount_string,statusCode];

}

async function caluculateCost(req,cartDetails,promoCode_string)
{
    total_price = 0;

    for (var i = 0; i < cartDetails.length; i++) 
    {
        total_price += cartDetails[i].price * cartDetails[i].quantity;
    }

    // sales_tax = 0.07 * total_price;
    //Using a new "total" in "tax" only, as stripe takes values in cents, Ex : $10 => 1000.
    const total = Math.ceil(total_price * 100);
    const tax = await stripe.tax.calculations.create({
        currency: 'usd',
        line_items: [
            {
                amount: total,
                reference: 'L1',
            },
        ],
        customer_details: {
            address: {
                line1: req.cookies.address1,
                line2: req.cookies.address2,
                city: req.cookies.address3,
                state: req.cookies.address4,
                postal_code: req.cookies.address5,
                country: 'US',
            },
            address_source: 'shipping',
        },
    });
    sales_tax = (tax.amount_total - total)/100;
    console.log("Sales Tax: ", sales_tax);
    console.log("promoCode string: ", promoCode_string);

    let promocode_discount = 0;
    if(promoCode_string !== undefined)
    {
        //check promo code
        [promocode_discount, promocode_discount_string,statusCode] = await checkPromoCode(promoCode_string,total_price);
    }
    return [total_price, sales_tax, promocode_discount];

}

router.post('/add-itemlisting', async (req, res)=>
{
    console.log("add-itemlisting inside ------------------------")


    //get authentication status and user id
    const [authentication, userId] = await authent(req,res);

    if(!authentication)
    {
        return;
    }
    

    //parse listingId from request
    //parse query parameters
    console.log("req data: ", req.body);
    // console.log("req.query: ", JSON.parse(req.body));
    const data = req.body;
    const listingId = data.listingId;

    // const listingId = req.body.listingId;

    console.log("listingId: ", listingId);

    //check if listingId exists in db
    const listingIdExists = await ItemListing.findOne({where:{listingId:listingId}});

    if(!listingIdExists)
    {
        //return 404 error - listingId does not exist in db
        res.status(404).send("listingId does not exist in db");
        console.log("listingId does not exist in db");
        return;
    }

    // if(listingIdExists.dataValues.quantity == 0)
    // {
    //     //return 400 error - quantity of listingId is 0
    //     res.status(400).send("quantity of listingId is 0");
    //     console.log("quantity of listingId is 0");
    //     return;
    // }

    //check if listingId already exists in cart
    const listingIdExistsInCart = await Cart.findOne({where:{listingId:listingId, userId:userId}});

    if(listingIdExistsInCart)
    {
        //return 409 error - listingId already exists in cart
        res.status(409).send("listingId already exists in cart");
        console.log("listingId already exists in cart");
        return;
    }

    console.log("my " ,userId, listingId);

    //add listingId to cart
    const addListingId = await Cart.create({userId:userId, listingId:listingId, quantity:1});

    //return success message
    res.status(200).send("listingId added to cart successfully");

});

router.post('/update-itemlisting', async (req, res)=>
{
    console.log("update-itemlisting inside ------------------------")

    //get authentication status and user id
    const [authentication, userid] = await authent(req,res);
    
    if(!authentication)
    {
        return;
    }

    //parse listingId from request
    //parse query parameters
    console.log("req.query: ", req.body);
    const listingId = req.body.listingId;
    const updateCount = req.body.updateCount;

    console.log("listingId: ", listingId);
    console.log("updateCount: ", updateCount);

    if (updateCount < 0)
    {
        //return 400 error - updateCount cannot be negative
        res.status(400).send("updateCount cannot be negative");
        console.log("updateCount cannot be negative");
        return;
    }

    if (updateCount == 0)
    {
        //remove listingId from cart
        const deleteListingId = await Cart.destroy({where:{userId:userid, listingId:listingId}});
        //return success message
        res.status(200).send("listingId deleted from cart successfully");
        return;
    }


    
    //check if listingId exists in db
    const listingIdExists = await ItemListing.findOne({where:{listingId:listingId}});

    if(!listingIdExists)
    {
        //return 404 error - listingId does not exist in db
        res.status(404).send("listingId does not exist in db");
        console.log("listingId does not exist in db");
        return;
    }

    //check if the quantity of listingId is greater than updateCount
    const listingIdQuantity = await ItemListing.findOne({where:{listingId:listingId}});

    if(listingIdQuantity.dataValues.quantity < updateCount)
    {
        //return 400 error - quantity of listingId is less than updateCount
        res.status(400).send("item count exceded the total stock in the inventory");
        console.log("quantity of listingId is less than updateCount");
        return;
    }

    //check if listingId already exists in cart
    const listingIdExistsInCart = await Cart.findOne({where:{listingId:listingId, userId:userid}});

    if(!listingIdExistsInCart)
    {
        //return 404 error - listingId does not exist in cart
        res.status(404).send("listingId does not exist in cart");
        console.log("listingId does not exist in cart");
        return;
    }

    //update listingId in cart
    const updateListingId = await Cart.update({quantity:updateCount},{where:{userId:userid, listingId:listingId}});

    //return success message
    res.status(200).send("listingId updated in cart successfully");

});

router.post('/remove-itemlisting', async (req, res)=>
{
    console.log("remove-itemlisting inside ------------------------")

    //get authentication status and user id
    const [authentication, userid] = await authent(req,res);
    
    if(!authentication)
    {
        return;
    }

    //parse listingId from request
    //parse query parameters
    var data = req.body;
    // console.log(data_temp);
    // console.log("req.query: ", JSON.parse(req.body));
    // data = JSON.parse(req.body);
    // console.log(data);
    const listingId = data['listingId'];

    console.log("listingId: ", data['listingId']);

    //check if listingId exists in db
    const listingIdExists = await ItemListing.findOne({where:{listingId:listingId}});

    //check if listingId already exists in cart
    const listingIdExistsInCart = await Cart.findOne({where:{listingId:listingId, userId:userid}});

    if(!listingIdExistsInCart)
    {
        //return 404 error - listingId does not exist in cart
        res.status(404).send("listingId does not exist in cart");
        console.log("listingId does not exist in cart");
        return;
    }

    //delete listingId from cart
    const deleteListingId = await Cart.destroy({where:{userId:userid, listingId:listingId}});

    //return success message
    res.status(200).send("listingId deleted from cart successfully");

});

router.get('/fetch-cart-display', async (req, res)=>
{
    //get authentication status and user id
    const [authentication, userId] = await authent(req,res);

    if(!authentication)
    {
        return;
    }

    //return cart details
    res.render('cart');
});

router.post('/fetch-cart-display', async (req, res)=>
{
    //return dummy value
    res.status(200).send("fetch-cart-display");
    
});

router.get('/fetch-cart', async (req, res)=>
{
    console.log("fetch-cart inside ------------------------")


    //get authentication status and user id
    const [authentication, userId] = await authent(req,res);

    if(!authentication)
    {
        return;
    }

    //get query parameters
    console.log("req.query: ", req.query.filter);
    let cartDetails = 0;

    if(req.query.filter == "false")
    {
        console.log("filter is false");
        cartDetails = await get_cart(userId,false);

    }
    else
    {
        console.log("filter is true");
        cartDetails = await get_cart(userId);
    }
    
    

    if(cartDetails.length === 0)
    {
        console.log("cart is empty")
        await res.status(400).send("Cart is empty");
        return;
    }



    //add total price to cartDetails
    for (var i = 0; i < cartDetails.length; i++) 
    {
        if(cartDetails[i].max_quantity != 0)
        {
            cartDetails[i].totalPrice = (cartDetails[i].price * cartDetails[i].quantity).toFixed(2);
        }
    }

    //calculate total price by adding all the total prices of each listing
    const justCart = req.query.justCart;

    console.log("just_cart: ", justCart);

    let total_price = 0;
    let sales_tax = 0;
    let promocode_discount = 0;
    let finalPrice = 0;

    if (justCart != "true" )
    {

        //get promocode string
        const promocode_string = req.cookies.promocode;

        //calculate cost
        [total_price, sales_tax, promocode_discount] = await caluculateCost(req,cartDetails,promocode_string);

        finalPrice = total_price + sales_tax - promocode_discount;

        
        //convert to 2 decimal places
        if (total_price != 0)
        {
            total_price = await total_price.toFixed(2);
        }
        sales_tax = await sales_tax.toFixed(2);
        promocode_discount = await promocode_discount.toFixed(2);
        finalPrice = await finalPrice.toFixed(2);

        console.log("in if finalPrice: ", finalPrice);

    }
    else
    {
        //calculate total price by adding all the total prices of each listing
        
        for (var i = 0; i < cartDetails.length; i++)
        {
            total_price += cartDetails[i].totalPrice;
        }
        
        sales_tax = 0;
        promocode_discount = 0;
        finalPrice = 0;
    }


    console.log("TotalPrice: ", total_price);
    let cartMaxQty = await getCartMaxQty(cartDetails);


    //return cart details
    res.status(200).json({
        cartDetails:cartDetails,
        TotalPrice:total_price,
        Promocode: promocode_discount,
        Sales:sales_tax,
        FinalPrice:finalPrice,
        CartMaxQty: cartMaxQty});

    

});

router.post('/flush', async (req, res)=>
{
    console.log("flush inside ------------------------")

    //get authentication status and user id
    const [authentication, userid] = await authent(req,res);
    
    if(!authentication)
    {
        return;
    }

    //delete cart details from db
    const deleteCartDetails = await Cart.destroy({where:{userId:userid}});

    //return success message
    res.status(200).send("Cart flushed successfully");
});

router.get('/get-payment-information', async (req, res)=>
{
    console.log("get-payment-information inside ------------------------")
});

router.post('/add-payment-information', async (req, res)=>
{
    console.log("add-payment-information inside ------------------------")
});

router.get('/fetch-address', async (req, res)=>
{
    console.log("fetch-address inside ------------------------")
});

router.get('/display-shipping-charges', async (req, res)=>
{
    console.log("display-shipping-charges inside ------------------------")
});

router.post('/check-promo-code', async (req, res)=> 
{
    console.log("check-promo-code inside ------------------------")

    const [authentication, userId] = await authent(req,res);
    
    if(!authentication)
    {
        return;
    }
   
    
    if(!userId)
    {
        return;
    }

    let cartDetails = await get_cart(userId)

    let total_price = 0;

    // check quantity of each listing
    for (var i = 0; i < cartDetails.length; i++)
    {
        const listingId = cartDetails[i].listingId;

        //check if listingId exists in db  
        const listingIdExists = await ItemListing.findOne({where:{listingId:listingId}});
        if(!listingIdExists)
        {
            //return 404 error - listingId does not exist in db
            res.status(404).send("listingId does not exist in db");
            console.log("listingId does not exist in db");
            return;
        }

        //check if the quantity of listingId is greater than updateCount

        const listingIdQuantity = await ItemListing.findOne({where:{listingId:listingId}});
        if(listingIdQuantity.dataValues.quantity < cartDetails[i].quantity)
        {
            //return 400 error - quantity of listingId is less than updateCount
            res.status(400).send("quantity of listingId is less than updateCount");
            console.log("quantity of listingId is less than updateCount");
            return;
        }

        //calculate total price of each listing
        cartDetails[i].totalPrice = cartDetails[i].price * cartDetails[i].quantity;
        total_price += cartDetails[i].totalPrice;
    }

    //parse promoCode from request
    //parse query parameters
    console.log("req.query: ", req.body);
    const promoCode1 = req.body.promocode;

    console.log("promoCode: ", promoCode1);


    //check promo code
    [promocode_discount, promocode_discount_string,statusCode] = await checkPromoCode(promoCode1,total_price);

    //send response
    res.status(statusCode).send(promocode_discount_string);

});

router.get('/orderplace', async (req, res) => { 
    
    console.log("orderplace inside ------------------------");
    res.redirect('/users/get-purchase-history');
});

router.get('/get-final-cost', async (req, res)=>
{
    console.log("get-final-cost inside ------------------------")
    
    //get authentication status and user id
    const [authentication, userId] = await authent(req,res);
    
    if(!authentication)
    {
        return;
    }

    res.cookie("promocode", req.query.promocode, {
        httpOnly: false,
    });

    res.cookie("address1", req.query.address1, {
        httpOnly: false,
    });

    res.cookie("address2", req.query.address2, {
        httpOnly: false,
    });
    res.cookie("address3", req.query.address3, {
        httpOnly: false,
    });
    res.cookie("address4", req.query.address4, {
        httpOnly: false,
    });
    res.cookie("address5", req.query.address5, {
        httpOnly: false,
    });
   
    
    
    res.render('checkout');
//    res.render()


});

async function generate_shipment(userDetails, endUserDetails, sellerUserDetails, sellerEndUserDetails) {



    return {
        shipmentId: shipmentId
    }
}

router.post('/checkout', async (req, res)=>
{
    console.log("checkout inside ------------------------");
    if (!UserUtil.authenticateToken(req.cookies.accessToken)) {
        // If not authenticated, send a 401 Unauthorized response
        return res.status(401).send('Authentication failed');
    }

    const payload = UserUtil.retrieveTokenPayload(req.cookies.accessToken);
    console.log("ACCESSING USERID FROM TOKEN PAYLOAD:", payload.userId);
    console.log("ACCESSING emailId FROM TOKEN PAYLOAD:", payload.emailId);

    let userDetails = await UserUtil.check_email(payload.emailId);
    const userId = payload.userId;


    const endUserDetails = await EndUser.findOne({where: {userId: payload.userId}});


    // get cart body
    let cartDetails = await get_cart(userId,include_cart_id = true)

    if(cartDetails.length == 0)
    {
        res.status(400).send("Cart is empty");
        return;
    }

    //calculate total price of each listing
    for (var i = 0; i < cartDetails.length; i++) 
    {
        cartDetails[i].totalPrice = cartDetails[i].price * cartDetails[i].quantity;
    }

    //calculate total price of all listings
    total_price = 0;
    for (var i = 0; i < cartDetails.length; i++) 
    {
        total_price += cartDetails[i].totalPrice;
    }

    //get promocode string
    const promocode_string = req.cookies.promocode;

    //check promo code
    [promocode_discount, promocode_discount_string,statusCode] = await checkPromoCode(promocode_string,total_price)

    //deactivate promocode
    if(promocode_string !== undefined)
    {
        const deactivatePromoCode = await Promocode.update({is_active:false},{where:{promocode:promocode_string}});
    }

    //get cartid from all cart details
    let cartIds = []
    for (var i = 0; i < cartDetails.length; i++) 
    {
        cartIds.push(cartDetails[i].cartId);
    }

    //delete cart details from db
    const deleteCartDetails = await Cart.destroy({where:{cartId:cartIds}});


    console.log("deletecartDetails: ", deleteCartDetails);


    //update quantity of each listing in db
    for (var i = 0; i < cartDetails.length; i++) 
    {
        // subtract quantity from listing
        const listingId = cartDetails[i].listingId;
        const quantity = cartDetails[i].quantity;
        const updateListingId = await ItemListing.decrement({quantity:quantity},{where:{listingId:listingId}});
    }


        const paymentId = req.body["paymentID"];
        const purchase = await Purchase.create({paymentId: paymentId, total_price: total_price, userId: userId});
        console.log("Auto-generated ID for Purchase: ", purchase.purchaseId);

        const EASYPOST_API_KEY = 'EZTKf21d82fc6abc492ca6f36522677d267aLtEijfmNnjsHlbQLWWYG4w';
        const client = new EasyPostClient(EASYPOST_API_KEY);
        let shipmentId;

        for (var i = 0; i < cartDetails.length; i++) {
            const itemListing =  await ItemListing.findOne({where: {listingId: cartDetails[i].listingId}});
            const sellerId = itemListing.sellerId;
            const sellerEndUserDetails = await EndUser.findOne({where: {userId: sellerId}})


            const sellerUserDetails = await User.findOne({where: {userId: sellerId}})

            await (async () => {
                let shipment;

                shipment = await client.Shipment.create({
                    // to_address: {
                    //     name: userDetails.dataValues.name,
                    //     street1: endUserDetails.address_line1,
                    //     street2: endUserDetails.address_line2,
                    //     city: endUserDetails.address_city,
                    //     state: endUserDetails.address_state_code,
                    //     zip: endUserDetails.address_zipcode,
                    //     country: 'US',
                    //     email: userDetails.emailId,
                    //     phone: endUserDetails.phone_nr,
                    // },
                    to_address: {
                        name: userDetails.dataValues.name,
                        street1: res.cookie.address1,
                        street2: res.cookie.address2,
                        city: res.cookie.address3,
                        state: res.cookie.address4,
                        zip: res.cookie.address5,
                        country: 'US',
                        email: userDetails.emailId,
                        phone: endUserDetails.phone_nr,
                    },
                    from_address: {
                        street1: sellerEndUserDetails.address_line1,
                        street2: sellerEndUserDetails.address_line2,
                        city: sellerEndUserDetails.address_city,
                        state: sellerEndUserDetails.address_state_code,
                        zip: sellerEndUserDetails.address_zipcode,
                        country: 'US',
                        company: 'ScarletElectronics',
                        phone: sellerEndUserDetails.phone_nr,
                    },
                    parcel: {
                        length: 20.2,
                        width: 10.9,
                        height: 5,
                        weight: 65.9,
                    }
                });
                shipmentId = shipment.id;
                console.log(shipment);
            })();

            const tracker = await (async () => {
                const tracker = await client.Tracker.create({
                    tracking_code: 'EZ2000000002',
                    carrier: 'USPS',
                });
                console.log(tracker);
                return tracker;
            })();

            const order = await Order.create({listingId: cartDetails[i].listingId, purchaseId: purchase.purchaseId, shipmentId:shipmentId, trackingId: tracker.id, trackingUrl: tracker.public_url, quantity: cartDetails[i].quantity, total_cost_of_item: cartDetails[i].price * 1.1, order_status: "in transit"});
            console.log("Auto-generated Order ID: ", order.orderId);
        }


    console.log("req.body: ", req.body);

    res.clearCookie("promocode");
    res.clearCookie("address1");
    res.clearCookie("address2");
    res.clearCookie("address3");
    res.clearCookie("address4");
    res.clearCookie("address5");
    //res.render('orderplace');

    res.status(200).send(JSON.stringify({message: "Order Placed Successfully", redirectUrl: "/cart/orderplace"}));

});


//export router
module.exports = { router, get_cart, caluculateCost};