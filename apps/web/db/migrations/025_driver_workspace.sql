INSERT INTO plan_modules (plan_code, module_code)
SELECT code, 'driver-navigation' FROM subscription_plans;
