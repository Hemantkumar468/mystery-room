/**
 * A broad, bundled list of Indian cities (all states + UTs, major and many
 * tier-2/3 cities). Used to power an autocomplete on city fields. It is
 * intentionally a *suggestion* list, not a hard whitelist — the inputs that
 * use it allow free text, so any city not listed here can still be typed. No
 * external API, no network dependency, works offline.
 *
 * To add more, just push names here (kept roughly alphabetical for scanning).
 */
export const INDIAN_CITIES = [
  // A
  'Adilabad', 'Agartala', 'Agra', 'Ahmedabad', 'Ahmednagar', 'Aizawl', 'Ajmer', 'Akola', 'Alappuzha',
  'Aligarh', 'Alwar', 'Ambala', 'Ambattur', 'Amravati', 'Amritsar', 'Anand', 'Anantapur', 'Asansol',
  'Aurangabad', 'Ayodhya',
  // B
  'Bahadurgarh', 'Balasore', 'Ballari', 'Bardhaman', 'Bareilly', 'Bathinda', 'Belagavi', 'Bengaluru',
  'Bangalore', 'Berhampur', 'Bhagalpur', 'Bharatpur', 'Bharuch', 'Bhavnagar', 'Bhilai', 'Bhilwara',
  'Bhiwandi', 'Bhiwani', 'Bhopal', 'Bhubaneswar', 'Bidar', 'Bijapur', 'Bikaner', 'Bilaspur', 'Bokaro',
  // C
  'Chandigarh', 'Chandrapur', 'Chennai', 'Chhindwara', 'Chittoor', 'Coimbatore', 'Cuttack',
  // D
  'Darbhanga', 'Davanagere', 'Dehradun', 'Delhi', 'Dewas', 'Dhanbad', 'Dharwad', 'Dhule', 'Dibrugarh',
  'Dimapur', 'Durg', 'Durgapur',
  // E-F
  'Eluru', 'Erode', 'Faridabad', 'Firozabad',
  // G
  'Gandhinagar', 'Gangtok', 'Gaya', 'Ghaziabad', 'Gorakhpur', 'Greater Noida', 'Gudivada', 'Gulbarga',
  'Guntur', 'Gurugram', 'Gurgaon', 'Guwahati', 'Gwalior',
  // H
  'Hajipur', 'Haldwani', 'Hapur', 'Haridwar', 'Hisar', 'Hospet', 'Hosur', 'Howrah', 'Hubballi',
  'Hyderabad',
  // I-J
  'Imphal', 'Indore', 'Itanagar', 'Jabalpur', 'Jaipur', 'Jalandhar', 'Jalgaon', 'Jammu', 'Jamnagar',
  'Jamshedpur', 'Jhansi', 'Jodhpur', 'Junagadh',
  // K
  'Kadapa', 'Kakinada', 'Kalyan', 'Kancheepuram', 'Kanpur', 'Karimnagar', 'Karnal', 'Kochi', 'Kohima',
  'Kolhapur', 'Kolkata', 'Kollam', 'Korba', 'Kota', 'Kottayam', 'Kozhikode', 'Kurnool',
  // L-M
  'Latur', 'Loni', 'Lucknow', 'Ludhiana', 'Madurai', 'Malegaon', 'Mangaluru', 'Mathura', 'Meerut',
  'Mehsana', 'Mira-Bhayandar', 'Moradabad', 'Morbi', 'Mumbai', 'Muzaffarnagar', 'Muzaffarpur', 'Mysuru',
  // N
  'Nadiad', 'Nagercoil', 'Nagpur', 'Nanded', 'Nashik', 'Navi Mumbai', 'Nellore', 'New Delhi', 'Nizamabad',
  'Noida',
  // O-P
  'Ongole', 'Palakkad', 'Panaji', 'Panipat', 'Panvel', 'Parbhani', 'Pathankot', 'Patiala', 'Patna',
  'Pimpri-Chinchwad', 'Pondicherry', 'Prayagraj', 'Pune', 'Puri', 'Purnia',
  // R
  'Raebareli', 'Raichur', 'Raipur', 'Rajahmundry', 'Rajkot', 'Ranchi', 'Ratlam', 'Rewa', 'Rohtak',
  'Roorkee', 'Rourkela',
  // S
  'Sagar', 'Saharanpur', 'Salem', 'Sambalpur', 'Sangli', 'Satara', 'Satna', 'Secunderabad', 'Shillong',
  'Shimla', 'Shimoga', 'Sikar', 'Silchar', 'Siliguri', 'Solapur', 'Sonipat', 'Srinagar', 'Surat',
  // T
  'Thane', 'Thanjavur', 'Thiruvananthapuram', 'Thoothukudi', 'Thrissur', 'Tiruchirappalli', 'Tirunelveli',
  'Tirupati', 'Tirupur', 'Tiruvannamalai', 'Tumakuru',
  // U-V
  'Udaipur', 'Ujjain', 'Ulhasnagar', 'Vadodara', 'Valsad', 'Varanasi', 'Vasai-Virar', 'Vellore',
  'Vijayawada', 'Visakhapatnam', 'Vizianagaram',
  // W-Z
  'Warangal', 'Wardha', 'Yamunanagar',
];

export default INDIAN_CITIES;
